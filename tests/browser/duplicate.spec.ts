import { expect, test, type Page } from "@playwright/test";
import { crc32, deflateSync } from "node:zlib";
import { NOTE_BINDING_HEADER } from "../../app/lib/noteClient";
import { sessionKeyCookieName } from "../../app/lib/noteSession";

function png(width: number, height: number, rgb: [number, number, number]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3).map((_, i) => rgb[i % 3])]);
  const pixels = deflateSync(Buffer.concat(Array.from({ length: height }, () => row)));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", pixels), chunk("IEND", Buffer.alloc(0))]);
}

const MINI_EMBED = `<!doctype html><html><body><p id="chart">Chart</p></body></html>`;

async function upload(
  request: import("@playwright/test").APIRequestContext,
  key: string,
  contentType: string,
  body: Buffer | string,
) {
  const res = await request.post("/api/assets", {
    data: { key, content_type: contentType, data_base64: Buffer.from(body).toString("base64") },
  });
  expect(res.status()).toBe(200);
  return (await res.json()) as { asset_id: string; markdown: string };
}

function keyFromPersistUrl(url: string) {
  const key = new URL(url).searchParams.get("key");
  if (!key) throw new Error(`no key in ${url}`);
  return key;
}

function handleFromUrl(url: string) {
  const match = /\/n\/([A-Za-z0-9_-]+)/.exec(url);
  if (!match) throw new Error(`no handle in ${url}`);
  return match[1];
}

async function desyncSessionCookie(page: Page, key: string) {
  const handle = handleFromUrl(page.url());
  const existing = (await page.context().cookies()).find((c) => c.name === sessionKeyCookieName(handle));
  expect(existing).toBeTruthy();
  await page.context().addCookies([{ ...existing!, value: key }]);
}

async function imageLoaded(page: Page, alt: string) {
  const image = page.locator(".note-image img").and(page.getByAltText(alt, { exact: true }));
  await expect(image).toBeVisible();
  await expect.poll(() =>
    image.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0),
  ).toBe(true);
}

test("duplicate note: menu, processing toast, redirect, arrival toast with Change key", async ({ page, request }) => {
  const key = `dup-browser-${Date.now()}`;
  await request.post("/api/content", { data: { key, content: "# Original\n\nKeep this line.", if_rev: 0 } });
  await page.goto(`/?key=${key}`);
  await expect(page.getByRole("heading", { name: "Original" })).toBeVisible();

  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("button", { name: "Duplicate note" }).click();
  await expect(page.getByRole("status")).toContainText("Duplicating");

  await expect(page.getByRole("heading", { name: "[COPY] Original" })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("status")).toContainText("Viewing duplicate");
  await page.getByRole("button", { name: "Change key", exact: true }).click();
  await expect(page.getByLabel("New secret key")).toBeVisible();
});

test("duplicate copies image and embed independently of the source note", async ({ page, request }, info) => {
  const key = `dup-assets-${info.project.name}-${Date.now()}`;
  await request.post("/api/content", { data: { key, content: "# Assets\n" } });
  const poster = await upload(request, key, "image/png", png(80, 48, [30, 90, 200]));
  const chart = await upload(request, key, "text/html", MINI_EMBED);
  await request.post("/api/content", {
    data: {
      key,
      content: `# Assets\n\n![Poster](marker-asset:${poster.asset_id})\n\n![Chart](marker-embed:${chart.asset_id} "h=200 poster=marker-asset:${poster.asset_id}")\n`,
    },
  });

  await page.goto(`/?key=${encodeURIComponent(key)}&persist=1`);
  await imageLoaded(page, "Poster");
  await expect(page.locator(".note-embed iframe")).toBeVisible();

  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("button", { name: "Duplicate note" }).click();
  await expect(page.getByRole("heading", { name: "[COPY] Assets" })).toBeVisible({ timeout: 15000 });

  const copyKey = keyFromPersistUrl(page.url());
  expect(copyKey).not.toBe(key);

  await request.delete(`/api/content?key=${encodeURIComponent(key)}`);
  await page.reload();
  await expect(page.getByRole("heading", { name: "[COPY] Assets" })).toBeVisible();
  await imageLoaded(page, "Poster");
  await expect(page.locator(".note-embed iframe")).toBeVisible();
  await expect(page.frameLocator(".note-embed iframe").locator("#chart")).toHaveText("Chart");
});

test("duplicate drops folder metadata without creator proof", async ({ page, request }, info) => {
  const stamp = `${info.project.name}-${Date.now()}`;
  const key = `dup-folder-${stamp}`;
  await request.post("/api/content", {
    data: {
      key,
      content: "# Foldered\n",
      creator_id: true,
      creator_name: "Dup tester",
      tags: ["alpha"],
    },
  });
  await page.goto(`/?key=${encodeURIComponent(key)}&persist=1`);
  await expect(page.getByRole("link", { name: "Dup tester", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("button", { name: "Duplicate note" }).click();
  await expect(page.getByRole("heading", { name: "[COPY] Foldered" })).toBeVisible({ timeout: 15000 });

  const copyKey = keyFromPersistUrl(page.url());
  const meta = await (await request.get(`/api/content?key=${encodeURIComponent(copyKey)}`)).json();
  expect(meta.has_creator).toBe(false);
  expect(meta.tags).toEqual([]);
  await expect(page.getByRole("link", { name: "Dup tester", exact: true })).toHaveCount(0);
});

test("duplicate copy is marked seen after load", async ({ page, request }, info) => {
  const key = `dup-seen-${info.project.name}-${Date.now()}`;
  await request.post("/api/content", { data: { key, content: "# Seen\nbody.", if_rev: 0 } });
  await page.goto(`/?key=${encodeURIComponent(key)}&persist=1`);
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("button", { name: "Duplicate note" }).click();
  await expect(page.getByRole("heading", { name: "[COPY] Seen" })).toBeVisible({ timeout: 15000 });

  const copyKey = keyFromPersistUrl(page.url());
  await expect.poll(async () => {
    const body = await (await request.get(`/api/content?key=${encodeURIComponent(copyKey)}`)).json();
    return body.seen_rev === body.rev;
  }).toBe(true);
});

test("stale tab duplicate returns 409 without creating a copy", async ({ browser, request }, info) => {
  const stamp = `${info.project.name}-${Date.now()}`;
  const keyA = `dup-stale-a-${stamp}`;
  const keyB = `dup-stale-b-${stamp}`;
  await request.post("/api/content", { data: { key: keyA, content: "# A\nalpha." } });
  await request.post("/api/content", { data: { key: keyB, content: "# B\nbeta." } });

  const context = await browser.newContext();
  const leader = await context.newPage();
  const follower = await context.newPage();
  await leader.goto(`/?key=${encodeURIComponent(keyA)}`);
  await expect(leader).toHaveURL(/\/n\/[A-Za-z0-9_-]+$/);
  await follower.goto(leader.url());
  await desyncSessionCookie(leader, keyB);

  let binding: string | null = null;
  await follower.route("**/api/content/duplicate", async (route) => {
    binding = route.request().headers()[NOTE_BINDING_HEADER] ?? route.request().headers()[NOTE_BINDING_HEADER.toLowerCase()];
    await route.continue();
  });
  await follower.getByRole("button", { name: "More" }).click();
  await follower.getByRole("button", { name: "Duplicate note" }).click();
  await expect(
    follower.getByRole("status").filter({ hasText: "Note changed in another tab" }),
  ).toBeVisible();
  expect(binding).toBeTruthy();
  await expect(follower.getByRole("heading", { name: "A" })).toBeVisible();
  await expect(follower.getByRole("heading", { name: "[COPY]" })).toHaveCount(0);

  const listed = await request.get(`/api/content?key=${encodeURIComponent(keyA)}`);
  expect((await listed.json()).content).toContain("alpha.");
  await context.close();
});
