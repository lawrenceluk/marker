import { test, expect, type Locator } from "@playwright/test";
import { checkRevision } from "../helpers/api-url";

async function activate(locator: Locator, touch: boolean) {
  if (touch) await locator.tap(); else await locator.click();
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
  // The toolbar can re-render once after load (a button briefly detaches), so measure until it settles.
  let boxes: { x: number; y: number; width: number; height: number }[] = [];
  await expect(async () => {
    const measured = await Promise.all(["Home", "Share", "Comments (0 open)", "Edit", "More"].map(name => nav.getByRole("button", { name, exact: true }).boundingBox()));
    expect(measured.every(Boolean)).toBe(true);
    boxes = measured as typeof boxes;
  }).toPass({ timeout: 10_000 });
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
  await expect(page).toHaveURL(/\/n\/[A-Za-z0-9_-]+$/);
  await activate(toggle, touch);
  await expect(toggle).toBeChecked();
  await expect(page).toHaveURL(new RegExp(`key=${key}&persist=1`));
  await page.keyboard.press("Escape");
  await expect(share).not.toBeVisible();
  await expect(nav.getByRole("button", { name: "Share", exact: true })).toBeFocused();
  await activate(nav.getByRole("button", { name: "More", exact: true }), touch);
  const more = page.getByRole("dialog", { name: "More options" });
  await expect(more.getByRole("button", { name: "Open another note", exact: true })).toBeFocused();
  await expect(more.getByRole("button")).toHaveText(["Open another note", "Copy text", "Duplicate note", "Change key", "Delete note"]);
  for (const name of ["Open another note", "Copy text", "Duplicate note", "Change key", "Delete note"])
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
  await page.route(
    (url) => new URL(url).pathname === "/api/revision",
    async (route) => {
      checks++;
      await route.fulfill({ json: { rev: 1 } });
    }
  );
  await page.clock.install();
  await page.goto(`/?key=${key}&persist=1`);
  await expect(page.getByRole("button", { name: "Comments (0 open)", exact: true })).toBeVisible();
  await checkRevision(page); // Focus resume clears unchanged before the timed poll loop.
  let baseline = checks;
  for (let i = 0; i < 2; i++) {
    await page.clock.runFor(20_000);
    const want = baseline + 1;
    await expect.poll(() => checks).toBe(want);
    baseline = want;
    await page.waitForTimeout(30);
  }
  await page.clock.runFor(59_000);
  expect(checks).toBe(baseline);
  await page.clock.runFor(1_000);
  const afterBackoff = baseline + 1;
  await expect.poll(() => checks).toBe(afterBackoff);
  baseline = afterBackoff;
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
  const afterVisible = baseline + 1;
  await expect.poll(() => checks).toBe(afterVisible);
  baseline = afterVisible;
  await checkRevision(page);
  expect(checks).toBe(baseline + 1);
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

test("the update pill is pinned at the top while scrolled, clear of the toolbar, and stays until refresh", async ({ page, request }, info) => {
  const touch = info.project.name === "iphone-webkit";
  const key = `nudge-sticky-${info.project.name}-${Date.now()}`;
  const paragraphs = Array.from({ length: 40 }, (_, i) => `Paragraph ${i + 1} of a long note that needs scrolling.`);
  await request.post("/api/content", { data: { key, content: paragraphs.join("\n\n") } });
  await page.goto(`/?key=${key}&persist=1`);
  await expect(page.locator(".prose")).toContainText("Paragraph 40");
  const updated = page.getByRole("button", { name: "Note updated · Refresh", exact: true });
  await request.post("/api/content", { data: { key, content: `${paragraphs.join("\n\n")}\n\nAdded elsewhere.`, mode: "overwrite" } });
  await checkRevision(page);
  await expect(updated).toBeVisible();

  // At the top it sits in the flow, below the toolbar.
  const toolbar = (await page.getByRole("navigation", { name: "Note actions" }).boundingBox())!;
  const top = (await updated.boundingBox())!;
  expect(top.y).toBeGreaterThanOrEqual(toolbar.y + toolbar.height);
  expect(await updated.evaluate(el => getComputedStyle(el).fontSize)).toBe("14px");
  expect(top.height).toBeGreaterThanOrEqual(32);

  // Scrolled to the bottom, it stays pinned near the top of the viewport and centered.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
  const viewport = page.viewportSize()!;
  const pinned = (await updated.boundingBox())!;
  expect(pinned.y).toBeGreaterThanOrEqual(0);
  expect(pinned.y).toBeLessThanOrEqual(16);
  expect(Math.abs(pinned.x + pinned.width / 2 - viewport.width / 2)).toBeLessThan(2);
  await page.screenshot({ animations: "disabled", path: `test-results/nudge-sticky-${info.project.name}.png` });

  // It only covers its own box: text beside it is still the hit target, and scrolling still works.
  const beside = await page.evaluate(({ y }) => document.elementFromPoint(12, y)?.closest(".update-nudge") === null, { y: pinned.y + pinned.height / 2 });
  expect(beside).toBe(true);
  const scrolled = await page.evaluate(() => window.scrollY);
  if (touch) await page.evaluate(() => window.scrollBy(0, -300));
  else await page.mouse.wheel(0, -300);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(scrolled);
  await expect(updated).toBeInViewport();

  await page.waitForTimeout(300);
  await checkRevision(page);
  await expect(updated).toBeVisible();
  await activate(updated, touch);
  await expect(page.locator(".prose")).toContainText("Added elsewhere.");
  await expect(updated).toHaveCount(0);
});
