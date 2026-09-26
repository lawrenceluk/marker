import { test, expect } from "@playwright/test";

test("selection bubble waits for gesture completion and never intercepts a drag", async ({ page, request }, info) => {
  const touch = info.project.name === "iphone-webkit";
  const key = `gesture-${info.project.name}`;
  const content = "Select this sentence slowly while dragging across where the comment bubble would appear.";
  await request.post("/api/content", { data: { key, content } });
  await page.goto(`/?key=${key}&persist=1`);
  await expect(page.getByRole("button", { name: "Comments (0 open)", exact: true })).toBeVisible();
  const icon = page.getByRole("button", { name: "Comment on selection" });
  const text = page.locator(".prose [data-source-start]").filter({ hasText: content });

  if (touch) {
    // WebKit emulation cannot drag native iOS handles: exercise their DOM event contract.
    await page.clock.install();
    await text.evaluate((element) => {
      element.dispatchEvent(new Event("touchstart", { bubbles: true }));
      const range = document.createRange();
      range.setStart(element.firstChild!, 0);
      range.setEnd(element.firstChild!, 12);
      window.getSelection()!.removeAllRanges();
      window.getSelection()!.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
    await page.evaluate(() => document.dispatchEvent(new PointerEvent("pointercancel", { pointerType: "touch" })));
    await page.clock.runFor(500);
    await expect(icon).toHaveCount(0);
    await page.evaluate(() => document.dispatchEvent(new PointerEvent("pointerup", { button: 0, pointerType: "touch" })));
    await page.clock.runFor(400);
    await expect(icon).toHaveCount(0);
    await text.evaluate((element) => {
      const end = new Event("touchend", { bubbles: true });
      Object.defineProperty(end, "touches", { value: [] });
      element.dispatchEvent(end);
    });
    await page.clock.runFor(250);
    await expect(icon).toHaveCount(0);
    // A handle adjustment resets the settle timer even without pointer/touch events.
    await text.evaluate((element) => {
      window.getSelection()!.getRangeAt(0).setEnd(element.firstChild!, 20);
      document.dispatchEvent(new Event("selectionchange"));
    });
    await page.clock.runFor(250);
    await expect(icon).toHaveCount(0);
    await page.clock.runFor(120);
    await expect(icon).toBeVisible();
    // Once shown, native adjustments follow continuously, including a touch
    // handoff that never delivers another touchend to the page.
    await text.evaluate((element) => element.dispatchEvent(new Event("touchstart", { bubbles: true })));
    await page.evaluate(() => document.dispatchEvent(new PointerEvent("pointercancel", { pointerType: "touch" })));
    await expect(icon).toBeVisible();
    for (const end of [25, 35, 22, 30]) {
      await text.evaluate((element, end) => {
        window.getSelection()!.getRangeAt(0).setEnd(element.firstChild!, end);
        document.dispatchEvent(new Event("selectionchange"));
      }, end);
      await expect(icon).toBeVisible();
      await page.clock.runFor(20); // One animation frame, well before settling.
      const selected = await page.evaluate(() => Array.from(window.getSelection()!.getRangeAt(0).getClientRects())
        .sort((a, b) => b.bottom - a.bottom || b.right - a.right)[0].toJSON());
      const box = await icon.boundingBox();
      expect(box!.x - selected.right).toBeCloseTo(14, 1);
      expect(box!.y + box!.height / 2).toBeCloseTo((selected.top + selected.bottom) / 2, 1);
      await expect(icon).toHaveCSS("pointer-events", "none");
    }
    await page.clock.runFor(370);
    await expect(icon).toBeVisible();
    await expect(icon).toHaveCSS("pointer-events", "auto");
    await page.screenshot({ path: "test-results/selection-touch-follow.png" });
    await icon.tap();
    await expect(page.getByLabel("Comment as You")).toBeFocused();
    await expect(page.locator(".comment-quote")).toHaveText(content.slice(0, 30));
    await page.keyboard.type("Extended quote");
    await page.getByRole("button", { name: "Send comment", exact: true }).tap();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    const snapshot = await (await request.get(`/api/comments?key=${key}`)).json();
    expect(snapshot.comments[0].anchor.exact).toBe(content.slice(0, 30));
    // A disjoint selection is new and must wait for the first-appearance delay.
    await page.locator(".prose").evaluate((root) => {
      const tail = [...root.querySelectorAll("[data-source-start]")].at(-1)!;
      tail.dispatchEvent(new Event("touchstart", { bubbles: true }));
      window.getSelection()!.setBaseAndExtent(tail.firstChild!, 5, tail.firstChild!, 15);
      const end = new Event("touchend", { bubbles: true });
      Object.defineProperty(end, "touches", { value: [] });
      tail.dispatchEvent(end);
      document.dispatchEvent(new Event("selectionchange"));
    });
    await page.clock.runFor(250);
    await expect(icon).toHaveCount(0);
    await page.clock.runFor(120);
    await expect(icon).toBeVisible();
  } else {
    const points = await text.evaluate((element) => {
      const range = document.createRange();
      range.setStart(element.firstChild!, 0);
      range.setEnd(element.firstChild!, 12);
      const first = range.getBoundingClientRect();
      range.setEnd(element.firstChild!, 45);
      const last = range.getBoundingClientRect();
      return { x: first.left + 0.1, y: (first.top + first.bottom) / 2, pause: first.right, end: last.right };
    });
    await page.mouse.move(points.x, points.y);
    await page.mouse.down();
    await page.mouse.move(points.pause, points.y, { steps: 12 });
    await page.waitForTimeout(450); // Longer than both selection debounce windows.
    await expect(icon).toHaveCount(0);
    expect(await page.evaluate(() => window.getSelection()!.toString())).toBe(content.slice(0, 12));
    // Cross the exact spot where the old mid-drag icon would have intercepted the pointer.
    await page.mouse.move(points.end, points.y, { steps: 30 });
    await page.waitForTimeout(450);
    await expect(icon).toHaveCount(0);
    expect(await page.evaluate(() => window.getSelection()!.toString())).toBe(content.slice(0, 45));
    await page.screenshot({ path: "test-results/selection-during-drag.png" });
    await page.mouse.up();
    await expect(icon).toBeVisible();
    expect(await page.evaluate(() => window.getSelection()!.toString())).toBe(content.slice(0, 45));
    const box = await icon.boundingBox();
    expect(box!.x - points.end).toBeCloseTo(4, 1);
    expect(box!.y + box!.height / 2).toBeCloseTo(points.y, 1);
    await page.screenshot({ path: "test-results/selection-after-drag.png" });

    // Keyboard selection stays hidden while a key is held, then debounces on release.
    await text.evaluate((element) => {
      window.getSelection()!.setBaseAndExtent(element.firstChild!, 5, element.firstChild!, 45);
    });
    await page.keyboard.down("Shift");
    await page.keyboard.down("ArrowLeft");
    await page.waitForTimeout(200);
    await expect(icon).toHaveCount(0);
    await page.keyboard.up("ArrowLeft");
    await page.keyboard.up("Shift");
    await expect(icon).toBeVisible();
    // New primary gestures disable hit testing in the same event, before React renders.
    const hitTesting = await text.evaluate((element) => {
      element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }));
      return document.querySelector<HTMLElement>(".comment-selection")?.style.pointerEvents;
    });
    expect(hitTesting).toBe("none");
    await expect(icon).toHaveCount(0);
    await page.evaluate(() => document.dispatchEvent(new MouseEvent("mouseup", { button: 0 })));
    await expect(icon).toBeVisible();
  }

  await page.evaluate(() => window.dispatchEvent(new Event("scroll")));
  await expect(icon).toHaveCount(0);
  if (touch) await page.clock.runFor(400);
  else await page.waitForTimeout(200);
  await expect(icon).toHaveCount(0);
  await page.evaluate(() => document.dispatchEvent(new Event("selectionchange")));
  if (touch) await page.clock.runFor(370);
  await expect(icon).toBeVisible();
  await page.evaluate(() => {
    window.getSelection()!.removeAllRanges();
    document.dispatchEvent(new Event("selectionchange"));
  });
  await expect(icon).toHaveCount(0);
});
