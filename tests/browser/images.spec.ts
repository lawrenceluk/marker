import { expect, test, type Page } from "@playwright/test";
import { crc32, deflateSync } from "node:zlib";

/** A solid-colour RGB PNG, big enough to tap. */
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

const MISSING_ID = "AAAAAAAAAAAAAAAAAAAAAA";

async function loaded(page: Page, alt: string) {
  const image = page.locator(".note-image img").and(page.getByAltText(alt, { exact: true }));
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth)).toBeGreaterThan(0);
  return image;
}

test("agent-uploaded and external images render, missing ones show a placeholder, and the lightbox opens", async ({ page, request }, info) => {
  const key = `images-view-${info.project.name}-${Date.now()}`;
  await request.post("/api/content", { data: { key, content: "# Pictures\n" } });
  const upload = await request.post("/api/assets", { data: { key, content_type: "image/png", data_base64: png(160, 90, [40, 120, 200]).toString("base64") } });
  expect(upload.status()).toBe(200);
  const { asset_id } = await upload.json();

  const externalRequests: string[] = [];
  await page.route("**://images.example.test/**", route => {
    externalRequests.push(route.request().url());
    return route.fulfill({ status: 200, contentType: "image/png", body: png(40, 40, [200, 60, 60]) });
  });

  const content = [
    "# Pictures",
    "",
    `![Blue box](marker-asset:${asset_id})`,
    "",
    "![Red square](http://images.example.test/red.png)",
    "",
    `![Gone](marker-asset:${MISSING_ID})`,
    "",
    "![Inline data](data:image/png;base64,iVBORw0KGgo=)",
    "",
    "Text after the images.",
  ].join("\n");
  await request.post("/api/content", { data: { key, content } });
  await page.goto(`/?key=${key}&persist=1`);

  const blue = await loaded(page, "Blue box");
  expect(await blue.getAttribute("src")).toMatch(/^https:\/\/127\.0\.0\.1:17382\/__r2\/marker-assets-test\/.+X-Amz-Signature=/);
  expect(await blue.getAttribute("referrerpolicy")).toBe("no-referrer");
  const red = await loaded(page, "Red square");
  expect(await red.getAttribute("src")).toBe("https://images.example.test/red.png");
  expect(externalRequests.every(url => url.startsWith("https://"))).toBe(true);

  await expect(page.getByRole("img", { name: "Gone" })).toContainText("Image unavailable");
  await expect(page.getByRole("img", { name: "Inline data" })).toContainText("Image unavailable");
  await page.screenshot({ path: `test-results/images-view-${info.project.name}.png`, fullPage: true });

  const opener = page.getByRole("button", { name: "Open image: Blue box" });
  if (info.project.name === "iphone-webkit") await opener.tap();
  else await opener.click();
  const dialog = page.getByRole("dialog", { name: "Blue box" });
  await expect(dialog).toBeVisible();
  await expect(page.locator(".comment-selection")).toHaveCount(0);
  await page.screenshot({ path: `test-results/images-lightbox-${info.project.name}.png` });
  await page.getByRole("button", { name: "Close image" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".comment-selection")).toHaveCount(0);

  const state = await (await request.get(`/api/content?key=${key}`)).json();
  expect(state.assets).toHaveLength(1);
  expect(state.assets[0]).toMatchObject({ id: asset_id, type: "image/png", markdown: `![](marker-asset:${asset_id})`, delete_after: null });
});

test("the editor uploads a chosen image, blocks Save until it lands, and renders it after saving", async ({ page, request }, info) => {
  const key = `images-editor-${info.project.name}-${Date.now()}`;
  await request.post("/api/content", { data: { key, content: "Before the picture." } });
  await page.goto(`/?key=${key}&persist=1`);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "Note content" });
  await editor.press("ControlOrMeta+End");

  let releasePut!: () => void;
  const putHeld = new Promise<void>(resolve => { releasePut = resolve; });
  await page.route("**/__r2/**", async route => {
    if (route.request().method() === "PUT") await putHeld;
    await route.continue();
  });

  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Insert image" }).click();
  await (await chooser).setFiles({ name: "Green [banner].png", mimeType: "image/png", buffer: png(120, 60, [40, 180, 90]) });
  await expect(editor).toHaveValue(/^Before the picture\.\n\n!\[Green banner\]\(marker-asset:[A-Za-z0-9_-]{22}\)\n$/);
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  releasePut();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await loaded(page, "Green banner");

  const state = await (await request.get(`/api/content?key=${key}`)).json();
  expect(state.assets).toHaveLength(1);
  expect(state.assets[0].delete_after).toBeNull();
});

test("the editor asks for a first save before adding images to a new note", async ({ page }, info) => {
  await page.goto(`/?key=images-new-${info.project.name}-${Date.now()}`);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Insert image" }).click();
  await (await chooser).setFiles({ name: "x.png", mimeType: "image/png", buffer: png(4, 4, [0, 0, 0]) });
  await expect(page.getByRole("alert").filter({ hasText: "Save this note first" })).toHaveText("Save this note first, then add images.");
  await expect(page.getByRole("textbox", { name: "Note content" })).toHaveValue("");
});
