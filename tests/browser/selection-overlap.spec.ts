import { test, expect } from "@playwright/test";

test("mobile selection actions avoid every highlighted line and accept touch taps", async ({ page, request }, info) => {
  test.skip(info.project.name !== "iphone-webkit", "Native touch selection proxy");
  const key = `selection-overlap-${Date.now()}`;
  const content = "A long selected sentence reaches the right viewport edge and wraps across several lines so neither floating action may cover any highlighted text.";
  await request.post("/api/content", { data: { key, content } });
  await page.goto(`/?key=${key}&persist=1`);
  await expect(page.getByRole("button", { name: "Comments (0 open)" })).toBeVisible();
  const select = async () => {
    // WebKit mobile emulation cannot operate OS selection handles. Replay their
    // touch/selectionchange contract with a real DOM range, then use real taps.
    await page.locator(".prose [data-source-start]").filter({ hasText: content }).evaluate(element => {
      element.dispatchEvent(new Event("touchstart", { bubbles: true }));
      window.getSelection()!.setBaseAndExtent(element.firstChild!, 0, element.firstChild!, element.firstChild!.textContent!.length);
      const end = new Event("touchend", { bubbles: true });
      Object.defineProperty(end, "touches", { value: [] });
      element.dispatchEvent(end);
      document.dispatchEvent(new Event("selectionchange"));
    });
    await page.waitForTimeout(500); // Allow native selection events to settle.
    const comment = page.getByRole("button", { name: "Comment on selection" });
    const reaction = page.getByRole("button", { name: "React to selection" });
    await expect(comment).toBeVisible();
    await expect(reaction).toBeVisible();
    const rects = await page.evaluate(() => Array.from(window.getSelection()!.getRangeAt(0).getClientRects(), r => r.toJSON()));
    for (const button of [comment, reaction]) {
      const box = (await button.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(4);
      expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width - 4);
      expect(box.y).toBeGreaterThanOrEqual(Math.max(...rects.map(r => r.bottom)) + 13.9);
      expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height - 4);
      expect(rects.some(r => box.x < r.right && box.x + box.width > r.left && box.y < r.bottom && box.y + box.height > r.top)).toBe(false);
    }
  };
  await select();
  await page.screenshot({ path: "test-results/selection-overlap-mobile.png" });
  await page.getByRole("button", { name: "React to selection" }).tap();
  await expect(page.getByRole("toolbar", { name: "Emoji reactions" })).toBeVisible();
  expect(await page.evaluate(() => window.getSelection()!.toString())).toBe(content);
  await page.getByRole("button", { name: "React with 👍" }).tap();
  await expect.poll(async () => (await (await request.get(`/api/comments?key=${key}`)).json()).comments.length).toBe(1);
  await select();
  await page.getByRole("button", { name: "Comment on selection" }).tap();
  await expect(page.getByLabel("Comment as You")).toBeFocused();
  await expect(page.locator(".comment-quote")).toHaveText(content);
  const snapshot = await (await request.get(`/api/comments?key=${key}`)).json();
  expect(snapshot.comments[0].anchor.exact).toBe(content);
});

for (const scenario of ["bottom", "long"] as const) {
  test(`mobile ${scenario} selection keeps actions and reaction bar clear`, async ({ page, request }, info) => {
    test.skip(info.project.name !== "iphone-webkit", "Native touch selection proxy");
    const key = `selection-${scenario}-${Date.now()}`;
    const content = scenario === "long" ? "Selected passage with many words. ".repeat(70).trim()
      : "Selected passage with many words. ".repeat(7).trim();
    await request.post("/api/content", { data: { key, content: `Before.\n\n${content}\n\nAfter.\n\n${"Filler.\n\n".repeat(30)}` } });
    await page.goto(`/?key=${key}&persist=1`);
    await expect(page.getByRole("button", { name: "Comments (0 open)" })).toBeVisible();
    const text = page.locator(".prose [data-source-start]").filter({ hasText: content }).first();
    if (scenario === "bottom") {
      await text.evaluate(element => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const bottom = Math.max(...Array.from(range.getClientRects(), r => r.bottom));
        window.scrollBy({ top: bottom - (window.innerHeight - 24), behavior: "instant" });
      });
      await page.waitForTimeout(100);
    } else {
      await text.evaluate(element => window.scrollBy({ top: element.getBoundingClientRect().top + 200, behavior: "instant" }));
      await page.waitForTimeout(100);
    }
    const initialScroll = await page.evaluate(() => window.scrollY);
    await text.evaluate(element => {
      element.dispatchEvent(new Event("touchstart", { bubbles: true }));
      window.getSelection()!.setBaseAndExtent(element.firstChild!, 0, element.firstChild!, element.textContent!.length);
      const end = new Event("touchend", { bubbles: true });
      Object.defineProperty(end, "touches", { value: [] });
      element.dispatchEvent(end);
      document.dispatchEvent(new Event("selectionchange"));
    });
    await page.waitForTimeout(700);
    const comment = page.getByRole("button", { name: "Comment on selection" });
    const reaction = page.getByRole("button", { name: "React to selection" });
    await expect(comment).toBeVisible();
    const clear = async (locator: typeof comment) => {
      const box = (await locator.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(4);
      expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height - 4);
      const overlaps = await page.evaluate(box => Array.from(window.getSelection()!.getRangeAt(0).getClientRects())
        .some(r => box.x < r.right && box.x + box.width > r.left && box.y < r.bottom && box.y + box.height > r.top), box);
      expect(overlaps).toBe(false);
    };
    await clear(comment);
    await clear(reaction);
    expect(await page.evaluate(() => window.getSelection()!.toString())).toBe(content);
    if (scenario === "long") expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(initialScroll);
    await reaction.tap();
    const bar = page.getByRole("toolbar", { name: "Emoji reactions" });
    await expect(bar).toBeVisible();
    await clear(bar);
    await page.screenshot({ path: `test-results/selection-${scenario}-mobile.png` });
  });
}

test("touch selection action cancels a slide off and prevents native defaults", async ({ page, request }, info) => {
  test.skip(info.project.name !== "iphone-webkit", "Touch listener contract");
  const key = `selection-cancel-${Date.now()}`;
  await request.post("/api/content", { data: { key, content: "Select these words." } });
  await page.goto(`/?key=${key}&persist=1`);
  await expect(page.getByRole("button", { name: "Comments (0 open)" })).toBeVisible();
  await page.locator(".prose [data-source-start]").first().evaluate(element => {
    window.getSelection()!.setBaseAndExtent(element.firstChild!, 0, element.firstChild!, 6);
    document.dispatchEvent(new Event("selectionchange"));
  });
  const button = page.getByRole("button", { name: "React to selection" });
  await expect(button).toBeVisible();
  const canceled = await button.evaluate(button => {
    const rect = button.getBoundingClientRect();
    // iOS WebKit does not expose constructible Touch/TouchEvent objects.
    const touch = (x: number) => ({ identifier: 1, target: button, clientX: x, clientY: rect.top + 10 });
    const start = new Event("touchstart", { bubbles: true, cancelable: true });
    Object.defineProperty(start, "touches", { value: [touch(rect.left + 10)] });
    const end = new Event("touchend", { bubbles: true, cancelable: true });
    Object.defineProperties(end, { changedTouches: { value: [touch(rect.right + 30)] }, touches: { value: [] } });
    button.dispatchEvent(start);
    button.dispatchEvent(end);
    return [start.defaultPrevented, end.defaultPrevented];
  });
  expect(canceled).toEqual([true, true]);
  await expect(page.getByRole("toolbar", { name: "Emoji reactions" })).toHaveCount(0);
  expect(await page.evaluate(() => window.getSelection()!.toString())).toBe("Select");
  await button.tap();
  await expect(page.getByRole("toolbar", { name: "Emoji reactions" })).toBeVisible();
});
