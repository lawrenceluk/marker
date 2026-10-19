import { expect, test } from "@playwright/test";
import { NOTE_BINDING_HEADER } from "../../app/lib/noteClient";
import { checkRevision } from "../helpers/api-url";

async function openOneOff(page: import("@playwright/test").Page, key: string) {
  await page.goto(`/?key=${encodeURIComponent(key)}`);
  await expect(page).toHaveURL(/\/n\/[A-Za-z0-9_-]+$/);
}

function handleFromUrl(url: string) {
  const match = /\/n\/([A-Za-z0-9_-]+)/.exec(url);
  if (!match) throw new Error(`no handle in ${url}`);
  return match[1];
}

/** Same handle cookie, different key than the in-memory binding → note_switched. */
async function desyncSessionCookie(
  page: import("@playwright/test").Page,
  key: string
) {
  const handle = handleFromUrl(page.url());
  const context = page.context();
  const existing = (await context.cookies()).find(
    (c) => c.name === `marker_sk_${handle}`
  );
  expect(existing).toBeTruthy();
  await context.addCookies([{ ...existing!, value: key }]);
}

async function expectSwitchedToast(page: import("@playwright/test").Page) {
  await expect(page.getByRole("status")).toContainText("Note changed in another tab");
  await expect(page.getByRole("button", { name: "Reopen" })).toBeVisible();
}

type NoteSnapshot = { content: string; rev: number; exists: boolean };

async function noteSnapshot(
  request: import("@playwright/test").APIRequestContext,
  key: string
): Promise<NoteSnapshot> {
  const res = await request.get(`/api/content?key=${encodeURIComponent(key)}`);
  const data = await res.json();
  return {
    content: data.content as string,
    rev: data.rev as number,
    exists: data.exists as boolean,
  };
}

function snapshotsEqual(a: NoteSnapshot, b: NoteSnapshot) {
  expect(a.content).toBe(b.content);
  expect(a.rev).toBe(b.rev);
  expect(a.exists).toBe(b.exists);
}

async function expectAbsent(
  request: import("@playwright/test").APIRequestContext,
  key: string
) {
  const snap = await noteSnapshot(request, key);
  expect(snap.exists).toBe(false);
}

async function captureTabBinding(page: import("@playwright/test").Page) {
  let binding: string | null = null;
  await page.route("**/api/**", async (route) => {
    const headers = route.request().headers();
    const value =
      headers[NOTE_BINDING_HEADER] ??
      headers[NOTE_BINDING_HEADER.toLowerCase()];
    if (value) binding = value;
    await route.continue();
  });
  await checkRevision(page);
  await page.unroute("**/api/**");
  expect(binding).toBeTruthy();
  return binding!;
}

/** Leader opens A; follower shares the session; leader's cookie is repointed at B. */
async function stalePair(
  browser: import("@playwright/test").Browser,
  request: import("@playwright/test").APIRequestContext,
  stamp: string
) {
  const keyA = `stale-a-${stamp}`;
  const keyB = `stale-b-${stamp}`;
  await request.post("/api/content", {
    data: { key: keyA, content: "# A\n\nNote **alpha** text." },
  });
  await request.post("/api/content", {
    data: { key: keyB, content: "# B\nbeta." },
  });
  const revA = (await noteSnapshot(request, keyA)).rev;

  const context = await browser.newContext();
  const leader = await context.newPage();
  const follower = await context.newPage();
  await openOneOff(leader, keyA);
  await follower.route(
    (url) => new URL(url).pathname === "/api/comments",
    async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          json: { rev: revA, comments: [], responses: [] },
        });
        return;
      }
      await route.continue();
    }
  );
  await follower.goto(leader.url());
  await desyncSessionCookie(leader, keyB);
  return { context, follower, keyA, keyB };
}

test("two tabs keep separate notes for one-off, persist, and folder opens", async ({
  browser,
  request,
}, info) => {
  const stamp = Date.now();
  const keyX = `tab-x-${info.project.name}-${stamp}`;
  const keyY = `tab-y-${info.project.name}-${stamp}`;
  await request.post("/api/content", {
    data: { key: keyX, content: "# Note X\nBody X." },
  });
  await request.post("/api/content", {
    data: { key: keyY, content: "# Note Y\nBody Y." },
  });

  const context = await browser.newContext();
  const pageX = await context.newPage();
  const pageY = await context.newPage();

  await openOneOff(pageX, keyX);
  await openOneOff(pageY, keyY);
  await expect(pageX.getByRole("heading", { name: "Note X" })).toBeVisible();
  await expect(pageY.getByRole("heading", { name: "Note Y" })).toBeVisible();

  await pageX.getByRole("button", { name: "Edit", exact: true }).click();
  await pageX.getByPlaceholder("Write markdown…").fill("# Note X\nEdited in X.");
  await pageX.getByRole("button", { name: "Save" }).click();
  await expect(pageX.getByText("Edited in X.")).toBeVisible();
  await expect(pageY.getByRole("heading", { name: "Note Y" })).toBeVisible();

  const agentY = await request.get(`/api/content?key=${encodeURIComponent(keyY)}`);
  const bodyY = await agentY.json();
  expect(bodyY.content).toContain("Body Y");
  expect(bodyY.content).not.toContain("Edited in X");

  await context.close();
});

test("persist links stay isolated per tab", async ({ browser, request }, info) => {
  const keyX = `persist-x-${info.project.name}-${Date.now()}`;
  const keyY = `persist-y-${info.project.name}-${Date.now()}`;
  await request.post("/api/content", { data: { key: keyX, content: "# PX\nx." } });
  await request.post("/api/content", { data: { key: keyY, content: "# PY\ny." } });

  const context = await browser.newContext();
  const pageX = await context.newPage();
  const pageY = await context.newPage();
  await pageX.goto(`/?key=${encodeURIComponent(keyX)}&persist=1`);
  await pageY.goto(`/?key=${encodeURIComponent(keyY)}&persist=1`);
  await expect(pageX.getByRole("heading", { name: "PX" })).toBeVisible();
  await expect(pageY.getByRole("heading", { name: "PY" })).toBeVisible();

  await pageX.getByRole("button", { name: "Edit", exact: true }).click();
  await pageX.getByPlaceholder("Write markdown…").fill("# PX\nchanged.");
  await pageX.getByRole("button", { name: "Save" }).click();
  await expect(pageY.getByRole("heading", { name: "PY" })).toBeVisible();

  const check = await request.get(`/api/content?key=${encodeURIComponent(keyY)}`);
  expect((await check.json()).content).toContain("y.");

  await context.close();
});

test("legacy /n with marker_key migrates to /n/handle", async ({ browser, request }, info) => {
  const key = `legacy-${info.project.name}-${Date.now()}`;
  await request.post("/api/content", { data: { key, content: "# Legacy\nhere." } });
  const context = await browser.newContext();
  await context.addCookies([
    {
      name: "marker_key",
      value: key,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    },
  ]);
  const page = await context.newPage();
  await page.goto("/n");
  await expect(page).toHaveURL(/\/n\/[A-Za-z0-9_-]+$/);
  await expect(page.getByRole("heading", { name: "Legacy" })).toBeVisible();
  await context.close();
});

test("stale binding shows toast on save", async ({ browser, request }, info) => {
  const stamp = `${info.project.name}-${Date.now()}`;
  const { context, follower, keyA, keyB } = await stalePair(browser, request, stamp);
  const beforeA = await noteSnapshot(request, keyA);
  const beforeB = await noteSnapshot(request, keyB);

  await follower.getByRole("button", { name: "Edit", exact: true }).click();
  await follower.getByPlaceholder("Write markdown…").fill("# A\nstale edit.");
  await follower.getByRole("button", { name: "Save" }).click();
  await expectSwitchedToast(follower);

  snapshotsEqual(await noteSnapshot(request, keyA), beforeA);
  snapshotsEqual(await noteSnapshot(request, keyB), beforeB);

  await context.close();
});

test("stale binding shows toast on rename and delete", async ({ browser, request }, info) => {
  const stamp = `${info.project.name}-${Date.now()}`;
  const { context, follower, keyA, keyB } = await stalePair(browser, request, stamp);
  const beforeA = await noteSnapshot(request, keyA);
  const beforeB = await noteSnapshot(request, keyB);
  const renamed = `${keyB}-renamed`;

  await follower.getByRole("button", { name: "More" }).click();
  await follower.getByRole("button", { name: "Change key" }).click();
  await follower.getByLabel("New secret key").fill(renamed);
  await follower.getByRole("button", { name: "Change key", exact: true }).click();
  await expectSwitchedToast(follower);

  snapshotsEqual(await noteSnapshot(request, keyA), beforeA);
  snapshotsEqual(await noteSnapshot(request, keyB), beforeB);
  await expectAbsent(request, renamed);

  await follower.getByRole("button", { name: "More" }).click();
  await follower.getByRole("button", { name: "Delete note" }).click();
  await follower.getByRole("button", { name: "Press again to delete note" }).click();
  await expectSwitchedToast(follower);

  snapshotsEqual(await noteSnapshot(request, keyA), beforeA);
  snapshotsEqual(await noteSnapshot(request, keyB), beforeB);
  expect((await noteSnapshot(request, keyA)).exists).toBe(true);
  expect((await noteSnapshot(request, keyB)).exists).toBe(true);

  await context.close();
});

test("stale binding shows toast when loading comments", async ({
  browser,
  request,
}, info) => {
  const stamp = `${info.project.name}-${Date.now()}`;
  const { context, follower, keyA, keyB } = await stalePair(browser, request, stamp);
  const beforeA = await noteSnapshot(request, keyA);
  const beforeB = await noteSnapshot(request, keyB);

  await follower.getByRole("button", { name: /Comments/ }).click();
  await expectSwitchedToast(follower);

  snapshotsEqual(await noteSnapshot(request, keyA), beforeA);
  snapshotsEqual(await noteSnapshot(request, keyB), beforeB);

  await context.close();
});

test("stale binding shows toast on comment POST", async ({ browser, request }, info) => {
  const touch = info.project.name === "iphone-webkit";
  const stamp = `${info.project.name}-${Date.now()}`;
  const { context, follower, keyA, keyB } = await stalePair(browser, request, stamp);
  const beforeA = await noteSnapshot(request, keyA);
  const beforeB = await noteSnapshot(request, keyB);

  await follower.locator(".prose").evaluate((root) => {
    const start = [...root.querySelectorAll("[data-source-start]")].find(
      (n) => n.textContent === "alpha"
    )!;
    const range = document.createRange();
    range.setStart(start.firstChild!, 0);
    range.setEnd(start.firstChild!, 5);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await follower.waitForTimeout(750);
  const icon = follower.getByRole("button", { name: "Comment on selection" });
  await expect(icon).toBeVisible({ timeout: 10_000 });
  if (touch) await icon.tap();
  else await icon.click();
  await follower.getByLabel("Comment as You").fill("Should not land");
  await follower.getByRole("button", { name: "Send comment", exact: true }).click();
  await expectSwitchedToast(follower);

  snapshotsEqual(await noteSnapshot(request, keyA), beforeA);
  snapshotsEqual(await noteSnapshot(request, keyB), beforeB);
  const comments = await request.get(`/api/comments?key=${encodeURIComponent(keyA)}&status=all`);
  expect((await comments.json()).comments?.length ?? 0).toBe(0);

  await context.close();
});

test("stale binding shows toast on overwrite-anyway save", async ({
  browser,
  request,
}, info) => {
  const stamp = `${info.project.name}-${Date.now()}`;
  const { context, follower, keyA, keyB } = await stalePair(browser, request, stamp);
  const beforeB = await noteSnapshot(request, keyB);
  const bumped = await noteSnapshot(request, keyA);
  await request.post("/api/content", {
    data: {
      key: keyA,
      content: "# A\nalpha.\n\nChanged elsewhere.",
      if_rev: bumped.rev,
    },
  });
  const afterBump = await noteSnapshot(request, keyA);

  await follower.getByRole("button", { name: "Edit", exact: true }).click();
  await follower.getByPlaceholder("Write markdown…").fill("# A\nlocal stale save.");
  await follower.getByRole("button", { name: "Save" }).click();
  await expectSwitchedToast(follower);

  snapshotsEqual(await noteSnapshot(request, keyA), afterBump);
  snapshotsEqual(await noteSnapshot(request, keyB), beforeB);

  await follower.getByRole("button", { name: "Save" }).click();
  await expectSwitchedToast(follower);
  snapshotsEqual(await noteSnapshot(request, keyA), afterBump);
  snapshotsEqual(await noteSnapshot(request, keyB), beforeB);

  await context.close();
});

test("stale binding blocks revision refresh without applying cookie note", async ({
  browser,
  request,
}, info) => {
  const stamp = `${info.project.name}-${Date.now()}`;
  const { context, follower, keyA, keyB } = await stalePair(browser, request, stamp);
  const binding = await captureTabBinding(follower);
  const beforeA = await noteSnapshot(request, keyA);
  const beforeB = await noteSnapshot(request, keyB);
  const proseBefore = await follower.locator(".prose").innerText();

  await request.post("/api/content", {
    data: { key: keyB, content: "# B\nhijacked beta.", mode: "overwrite" },
  });

  const refresh = await follower.evaluate(
    async ({ tabBinding, header }) => {
      const response = await fetch("/api/content", {
        cache: "no-store",
        credentials: "include",
        headers: { [header]: tabBinding },
      });
      const body = await response.json();
      return { status: response.status, code: body.code as string | undefined };
    },
    { tabBinding: binding, header: NOTE_BINDING_HEADER }
  );
  expect(refresh.status).toBe(409);
  expect(refresh.code).toBe("note_switched");

  await expect(follower.locator(".prose")).toHaveText(proseBefore);
  expect(await follower.locator(".prose").innerText()).not.toContain("hijacked");
  snapshotsEqual(await noteSnapshot(request, keyA), beforeA);
  snapshotsEqual(await noteSnapshot(request, keyB), {
    ...beforeB,
    content: "# B\nhijacked beta.",
    rev: beforeB.rev + 1,
  });

  const nudge = follower.getByRole("button", { name: "Note updated · Refresh", exact: true });
  if (await nudge.isVisible().catch(() => false)) {
    await nudge.click();
    await expectSwitchedToast(follower);
    await expect(follower.locator(".prose")).toHaveText(proseBefore);
    snapshotsEqual(await noteSnapshot(request, keyA), beforeA);
  }

  await context.close();
});

test("opening many one-off notes keeps at most 20 session handles", async ({
  browser,
  request,
}, info) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  for (let i = 0; i < 30; i++) {
    const key = `bound-${info.project.name}-${Date.now()}-${i}`;
    await request.post("/api/content", { data: { key, content: `# ${i}\n` } });
    await page.goto(`/?key=${encodeURIComponent(key)}`);
  }
  const cookies = await context.cookies();
  const handles = cookies.filter((c) => c.name.startsWith("marker_sk_"));
  expect(handles.length).toBeLessThanOrEqual(20);
  await context.close();
});

test("reloading a persist link reuses one handle", async ({ browser, request }, info) => {
  const key = `persist-reuse-${info.project.name}-${Date.now()}`;
  await request.post("/api/content", { data: { key, content: "# P\nbody." } });
  const context = await browser.newContext();
  const page = await context.newPage();
  for (let i = 0; i < 50; i++) {
    await page.goto(`/?key=${encodeURIComponent(key)}&persist=1`);
    await expect(page.getByRole("heading", { name: "P" })).toBeVisible();
  }
  const cookies = await context.cookies();
  const handles = cookies.filter((c) => c.name.startsWith("marker_sk_"));
  expect(handles.length).toBe(1);
  await context.close();
});

test("cleared session cookies show closed toast on save", async ({
  browser,
  request,
}, info) => {
  const key = `expired-${info.project.name}-${Date.now()}`;
  await request.post("/api/content", { data: { key, content: "# E\nx." } });
  const context = await browser.newContext();
  const page = await context.newPage();
  await openOneOff(page, key);
  await context.clearCookies();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByPlaceholder("Write markdown…").fill("# E\nedited.");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toContainText("This note was closed");
  await expect(page.getByRole("button", { name: "Open" })).toBeVisible();
  await context.close();
});
