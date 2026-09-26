import { test, expect, type Locator, type Page } from "@playwright/test";

async function activate(locator: Locator, touch: boolean) {
  if (touch) await locator.tap(); else await locator.click();
}
async function checkRevision(page: Page) {
  await page.waitForTimeout(50); // Let any preceding request finish before the focus check.
  await Promise.all([
    page.waitForResponse(response => response.url().endsWith("/api/revision")),
    page.evaluate(() => window.dispatchEvent(new Event("focus"))),
  ]);
}

test("five actions fit one row; share and more preserve note actions", async ({ page, request }, info) => {
  const touch = info.project.name === "iphone-webkit";
  const key = `nav-${info.project.name}`;
  const content = "# A quieter toolbar\n\nSelect a sentence to leave a comment. Agent updates appear when you choose to refresh.";
  await request.post("/api/content", { data: { key, content } });
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { value: {
    writeText: async (value: string) => { (window as unknown as { copied: string }).copied = value; },
  } }));
  await page.goto(`/?key=${key}&persist=1`);
  const nav = page.getByRole("navigation", { name: "Note actions" });
  await expect(nav.getByRole("button")).toHaveCount(5);
  const boxes = await Promise.all(["Home", "Share", "Comments (0 open)", "Edit", "More"].map(name => nav.getByRole("button", { name, exact: true }).boundingBox()));
  expect(new Set(boxes.map(box => box!.y)).size).toBe(1);
  expect(boxes.at(-1)!.x + boxes.at(-1)!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.screenshot({ animations: "disabled", path: `test-results/nav-${info.project.name}-${colorScheme}.png` });
  }
  await activate(nav.getByRole("button", { name: "Share", exact: true }), touch);
  const share = page.getByRole("dialog", { name: "Share options" });
  await expect(share.getByRole("button", { name: "Copy link" })).toBeFocused();
  await page.screenshot({ animations: "disabled", path: `test-results/share-${info.project.name}.png` });
  await activate(share.getByRole("button", { name: "Copy link" }), touch);
  expect(await page.evaluate(() => (window as unknown as { copied: string }).copied)).toContain(`?key=${key}&persist=1`);
  const toggle = share.getByRole("switch", { name: "Persistent link" });
  await expect(toggle).toBeChecked();
  await activate(toggle, touch);
  await expect(toggle).not.toBeChecked();
  await expect(share.locator("[data-copy-status]")).toBeDisabled();
  await expect(page).toHaveURL(/\/$/);
  await activate(toggle, touch);
  await expect(toggle).toBeChecked();
  await expect(page).toHaveURL(new RegExp(`key=${key}&persist=1`));
  await page.keyboard.press("Escape");
  await expect(share).not.toBeVisible();
  await expect(nav.getByRole("button", { name: "Share", exact: true })).toBeFocused();
  await activate(nav.getByRole("button", { name: "More", exact: true }), touch);
  const more = page.getByRole("dialog", { name: "More options" });
  await expect(more.getByRole("button", { name: "Open another note", exact: true })).toBeFocused();
  await expect(more.getByRole("button")).toHaveText(["Open another note", "Copy text", "Change key", "Delete note"]);
  for (const name of ["Open another note", "Copy text", "Change key", "Delete note"])
    await expect(more.getByRole("button", { name, exact: true }).locator("svg")).toHaveCount(1);
  await page.keyboard.press("ArrowDown");
  await expect(more.getByRole("button", { name: "Copy text" })).toBeFocused();
  await page.screenshot({ animations: "disabled", path: `test-results/more-${info.project.name}.png` });
  await activate(more.getByRole("button", { name: "Copy text" }), touch);
  expect(await page.evaluate(() => (window as unknown as { copied: string }).copied)).toBe(content);
  await activate(more.getByRole("button", { name: "Change key", exact: true }), touch);
  await expect(more).not.toBeVisible();
  await page.getByPlaceholder("New secret key").fill(`${key}-renamed`);
  await activate(page.getByRole("button", { name: "Change key", exact: true }), touch);
  await expect(page).toHaveURL(new RegExp(`${key}-renamed`));
  expect((await (await request.get(`/api/content?key=${key}-renamed`)).json()).content).toBe(content);
  await activate(nav.getByRole("button", { name: "More", exact: true }), touch);
  await activate(more.getByRole("button", { name: "Open another note", exact: true }), touch);
  await expect(page.getByRole("heading", { name: "Marker", exact: true })).toBeVisible();
  await page.goto(`/?key=${key}-renamed&persist=1`);
  await activate(nav.getByRole("button", { name: "More", exact: true }), touch);
  await activate(more.getByRole("button", { name: "Delete note", exact: true }), touch);
  expect((await (await request.get(`/api/content?key=${key}-renamed`)).json()).exists).toBe(true);
  await activate(more.getByRole("button", { name: "Press again to delete note", exact: true }), touch);
  await expect(page.getByRole("heading", { name: "Marker", exact: true })).toBeVisible();
  expect((await (await request.get(`/api/content?key=${key}-renamed`)).json()).exists).toBe(false);
});

test("revision polling pauses hidden, checks focus/visible and backs off after three unchanged reads", async ({ page, request }, info) => {
  const key = `poll-${info.project.name}`;
  await request.post("/api/content", { data: { key, content: "Polling fixture" } });
  let checks = 0;
  await page.route("**/api/revision", async route => { checks++; await route.fulfill({ json: { rev: 1 } }); });
  await page.clock.install();
  await page.goto(`/?key=${key}&persist=1`);
  await expect(page.getByRole("button", { name: "Comments (0 open)", exact: true })).toBeVisible();
  await checkRevision(page); // Reset the unchanged counter with a completed focus check.
  let baseline = checks;
  for (let i = 0; i < 2; i++) {
    await page.clock.runFor(20_000);
    await expect.poll(() => checks).toBe(++baseline);
    await page.waitForTimeout(30);
  }
  await page.clock.runFor(59_000);
  expect(checks).toBe(baseline);
  await page.clock.runFor(1_000);
  await expect.poll(() => checks).toBe(++baseline);
  await page.waitForTimeout(30);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });
  await page.clock.runFor(600_000);
  expect(checks).toBe(baseline);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => checks).toBe(++baseline);
  await checkRevision(page);
  expect(checks).toBe(++baseline);
});

test("external revisions nudge without replacing text; drafts defer it and own writes do not nudge", async ({ page, request }, info) => {
  const touch = info.project.name === "iphone-webkit";
  const key = `nudge-${info.project.name}`;
  await request.post("/api/content", { data: { key, content: "Original sentence for review." } });
  await page.goto(`/?key=${key}&persist=1`);
  await expect(page.locator(".prose")).toHaveText("Original sentence for review.");
  const updated = page.getByRole("button", { name: "Note updated · Refresh", exact: true });
  await checkRevision(page);
  await expect(updated).toHaveCount(0);
  await request.post("/api/comments", { data: { key, if_rev: 1, content: "Original sentence for review. Added elsewhere.", operations: [{ action: "create", start: 0, end: 17, text: "Agent question" }] } });
  await checkRevision(page);
  await expect(updated).toBeVisible();
  await expect(page.locator(".prose")).toHaveText("Original sentence for review.");
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.screenshot({ animations: "disabled", path: `test-results/nudge-${info.project.name}-${colorScheme}.png` });
  }
  await activate(updated, touch);
  await expect(page.locator(".prose")).toContainText("Added elsewhere.");
  await expect(page.getByRole("button", { name: "Comments (1 open)", exact: true })).toBeVisible();
  await activate(page.locator("mark"), touch);
  await page.getByLabel("Reply as You").fill("Keep my draft");
  await request.post("/api/content", { data: { key, content: "Original sentence for review. Another external edit." } });
  await checkRevision(page);
  await expect(updated).toHaveCount(0);
  await expect(page.getByLabel("Reply as You")).toHaveValue("Keep my draft");
  await expect(page.locator(".prose")).toContainText("Added elsewhere.");
  await activate(page.getByRole("button", { name: "Close", exact: true }), touch);
  await expect(updated).toBeVisible();
  await activate(updated, touch);
  await expect(page.locator(".prose")).toContainText("Another external edit.");
  await activate(page.locator("mark"), touch);
  await page.getByLabel("Reply as You").fill("My own reply");
  await activate(page.getByRole("button", { name: "Send reply", exact: true }), touch);
  await expect(page.getByText("My own reply", { exact: true })).toBeVisible();
  await activate(page.getByRole("button", { name: "Close", exact: true }), touch);
  await checkRevision(page);
  await expect(updated).toHaveCount(0);
  await activate(page.getByRole("button", { name: "Edit", exact: true }), touch);
  await request.post("/api/content", { data: { key, content: "Original sentence for review. Changed while editing." } });
  await checkRevision(page);
  await expect(updated).toHaveCount(0);
  await expect(page.getByPlaceholder("Write markdown…")).toHaveValue("Original sentence for review. Another external edit.");
  await activate(page.getByRole("button", { name: "Cancel", exact: true }), touch);
  await expect(updated).toBeVisible();
  await activate(updated, touch);
  await activate(page.getByRole("button", { name: "Edit", exact: true }), touch);
  await page.getByPlaceholder("Write markdown…").fill("My own edit.");
  await activate(page.getByRole("button", { name: "Save", exact: true }), touch);
  await expect(page.locator(".prose")).toHaveText("My own edit.");
  await checkRevision(page);
  await expect(updated).toHaveCount(0);
});
