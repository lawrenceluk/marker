import { expect, test } from "@playwright/test";

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

async function stalePair(
  browser: import("@playwright/test").Browser,
  request: import("@playwright/test").APIRequestContext,
  stamp: string
) {
  const keyA = `stale-a-${stamp}`;
  const keyB = `stale-b-${stamp}`;
  const other = `stale-other-${stamp}`;
  await request.post("/api/content", {
    data: { key: keyA, content: "# A\nalpha." },
  });
  await request.post("/api/content", {
    data: { key: keyB, content: "# B\nbeta." },
  });
  await request.post("/api/content", {
    data: { key: other, content: "# Other\nuntouched." },
  });

  const context = await browser.newContext();
  const leader = await context.newPage();
  const follower = await context.newPage();
  await openOneOff(leader, keyA);
  await follower.goto(leader.url());
  await desyncSessionCookie(leader, keyB);
  return { context, follower, keyB, other };
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
  const { context, follower, other } = await stalePair(
    browser,
    request,
    `${info.project.name}-${Date.now()}`
  );

  await follower.getByRole("button", { name: "Edit", exact: true }).click();
  await follower.getByPlaceholder("Write markdown…").fill("# B\nstale edit.");
  await follower.getByRole("button", { name: "Save" }).click();
  await expectSwitchedToast(follower);

  const untouched = await request.get(`/api/content?key=${encodeURIComponent(other)}`);
  expect((await untouched.json()).content).toContain("untouched.");

  await context.close();
});

test("stale binding shows toast on rename and delete", async ({ browser, request }, info) => {
  const stamp = `${info.project.name}-${Date.now()}`;
  const { context, follower, keyB, other } = await stalePair(browser, request, stamp);

  await follower.getByRole("button", { name: "More" }).click();
  await follower.getByRole("button", { name: "Change key" }).click();
  await follower.getByLabel("New secret key").fill(`${keyB}-renamed`);
  await follower.getByRole("button", { name: "Change key", exact: true }).click();
  await expectSwitchedToast(follower);

  const stillB = await request.get(`/api/content?key=${encodeURIComponent(keyB)}`);
  expect(stillB.ok()).toBeTruthy();

  await follower.getByRole("button", { name: "More" }).click();
  await follower.getByRole("button", { name: "Delete note" }).click();
  await follower.getByRole("button", { name: "Press again to delete note" }).click();
  await expectSwitchedToast(follower);

  const untouched = await request.get(`/api/content?key=${encodeURIComponent(other)}`);
  expect((await untouched.json()).content).toContain("untouched.");

  await context.close();
});

test("stale binding shows toast when loading comments", async ({
  browser,
  request,
}, info) => {
  const { context, follower } = await stalePair(
    browser,
    request,
    `${info.project.name}-${Date.now()}`
  );

  await follower.getByRole("button", { name: /Comments/ }).click();
  await expectSwitchedToast(follower);

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
