import { test, expect, type Page } from "@playwright/test";

// Synthetic Apple Pencil strokes on an iPad viewport. The pass condition is the brief's
// outside check: after rotation (reflow) and reload each stroke still overlaps its
// original text, and the agent export quotes that exact text.
const PARAGRAPH = "The first milestone ships a small reader that loads quickly on slow networks and keeps the original Markdown as the source of truth, so every agent that edits the note can trust what it reads, while five careful reviewers mark up the draft by hand before anything is published to the wider team.";
const TARGETS = { circle: "milestone", strike: "slow networks", underline: "five careful reviewers" } as const;

type Box = { left: number; top: number; right: number; bottom: number };

/** Client rects of a phrase, measured straight from the DOM (independent of the app's own helpers). */
async function rectsOf(page: Page, quote: string): Promise<Box[]> {
  return page.evaluate((quote) => {
    const walker = document.createTreeWalker(document.querySelector(".prose")!, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.textContent!.indexOf(quote);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + quote.length);
      return [...range.getClientRects()].filter(r => r.width > 0).map(r => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom }));
    }
    throw new Error(`no text ${quote}`);
  }, quote);
}

async function pen(page: Page, points: { x: number; y: number }[]) {
  await page.evaluate((points) => {
    const target = document.elementFromPoint(points[0].x, points[0].y)!;
    const fire = (type: string, p: { x: number; y: number }, pressure: number) => target.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true, pointerId: 7, pointerType: "pen", isPrimary: true, button: type === "pointermove" ? -1 : 0, buttons: type === "pointerup" ? 0 : 1, clientX: p.x, clientY: p.y, pressure,
    }));
    fire("pointerdown", points[0], 0.4);
    for (const p of points.slice(1)) fire("pointermove", p, 0.6);
    fire("pointerup", points.at(-1)!, 0);
  }, points);
}

async function drawOn(page: Page) {
  await page.getByRole("navigation", { name: "Note actions" }).getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("button", { name: "Draw on note" }).click();
  await expect(page.getByRole("toolbar", { name: "Ink" })).toBeVisible();
}

const intersects = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

async function strokeBoxes(page: Page) {
  return page.locator(".ink-layer path[data-stroke-id]").evaluateAll(paths => paths.map(p => {
    const r = p.getBoundingClientRect();
    return { id: p.getAttribute("data-stroke-id")!, kind: p.getAttribute("data-kind")!, box: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } };
  }));
}

async function expectAnchored(page: Page, quotes: Record<string, string>) {
  const paths = await strokeBoxes(page);
  // A wrapped underline/strike renders one path per line ("underline-1"…), all sharing one id.
  expect([...new Set(paths.map(p => p.kind.replace(/-\d+$/, "")))].sort()).toEqual(Object.keys(TARGETS).sort());
  expect(new Set(paths.map(p => p.id)).size).toBe(3);
  for (const path of paths) {
    const rects = await rectsOf(page, quotes[path.id]);
    expect(rects.some(r => intersects(path.box, r)), `${path.kind} overlaps “${quotes[path.id]}”`).toBe(true);
    if (path.kind === "strike") {
      // A strike stays inside the text's line band; an underline sits on its bottom edge.
      const r = rects.find(r => intersects(path.box, r))!;
      expect(path.box.top).toBeGreaterThan(r.top);
      expect(path.box.bottom).toBeLessThan(r.bottom);
    }
    if (path.kind.startsWith("underline")) expect(rects.some(r => intersects(path.box, r) && path.box.bottom > r.bottom - 4)).toBe(true);
  }
}

test("Pencil circle, strike and underline survive rotation and reload, and export exact quotes", async ({ page, request }, info) => {
  test.skip(info.project.name !== "ipad-webkit", "iPad-only flow");
  const key = "ink-ipad";
  const content = `# Ink test\n\n## The plan\n\n${PARAGRAPH}\n\nA second paragraph keeps the page tall enough to scroll.\n`;
  await request.post("/api/content", { data: { key, content } });
  await page.setViewportSize({ width: 834, height: 1194 }); // portrait
  await page.goto(`/?key=${key}&persist=1`);
  await drawOn(page);
  await expect(page.getByRole("toolbar", { name: "Ink" })).toBeVisible();
  await page.getByRole("button", { name: "Red pen" }).click();

  // Circle a single word.
  const [word] = await rectsOf(page, TARGETS.circle);
  const cx = (word.left + word.right) / 2, cy = (word.top + word.bottom) / 2;
  const rx = (word.right - word.left) / 2 + 8, ry = (word.bottom - word.top) / 2 + 5;
  await pen(page, Array.from({ length: 36 }, (_, i) => ({ x: cx + rx * Math.cos((i / 34) * 2 * Math.PI), y: cy + ry * Math.sin((i / 34) * 2 * Math.PI) })));
  await expect(page.locator(".ink-layer")).toHaveAttribute("data-ink-count", "1");

  // Strike through a phrase; underline another. Each must sit on one line in portrait.
  await page.getByRole("button", { name: "Blue pen" }).click();
  for (const kind of ["strike", "underline"] as const) {
    const rects = await rectsOf(page, TARGETS[kind]);
    expect(rects.length, `${kind} target on one line`).toBe(1);
    const r = rects[0];
    const y = kind === "strike" ? (r.top + r.bottom) / 2 : r.bottom + 1;
    await pen(page, Array.from({ length: 14 }, (_, i) => ({ x: r.left + 2 + ((r.right - r.left - 4) * i) / 13, y: y + (i % 2 ? 0.8 : -0.8) })));
  }
  await expect(page.locator(".ink-layer")).toHaveAttribute("data-ink-count", "3");
  await expect(page.locator(".ink-layer path[data-stroke-id]")).toHaveCount(3);

  // The stored export names the exact text and kind of each stroke.
  await expect.poll(async () => (await (await request.get(`/api/annotations?key=${key}`)).json()).ink_rev).toBe(3);
  const data = await (await request.get(`/api/annotations?key=${key}`)).json();
  const byKind = Object.fromEntries(data.annotations.map((a: { kind: string; quote: string }) => [a.kind, a.quote]));
  expect(byKind).toEqual(TARGETS);
  expect(data.rev).toBe(1); // ink never bumps the note's content revision
  const quotes: Record<string, string> = Object.fromEntries(data.annotations.map((a: { id: string; quote: string }) => [a.id, a.quote]));
  for (const a of data.annotations) expect(a.block).toMatchObject({ kind: "paragraph", line: 5 });
  const markdown = await (await request.get(`/api/annotations?key=${key}&format=markdown`)).text();
  expect(markdown).toContain("Circled “milestone” in red");
  expect(markdown).toContain("Struck through “slow networks” in blue");
  expect(markdown).toContain("Underlined “five careful reviewers” in blue");
  await expectAnchored(page, quotes);
  await page.screenshot({ path: "test-results/ink-portrait.png" });

  // Rotate to landscape: the paragraph reflows and every stroke follows its words.
  const before = Object.fromEntries((await strokeBoxes(page)).map(p => [p.kind, p.box]));
  const wordBefore = (await rectsOf(page, TARGETS.strike))[0];
  await page.setViewportSize({ width: 1194, height: 834 });
  await expect.poll(async () => (await rectsOf(page, TARGETS.strike))[0].left).not.toBeCloseTo(wordBefore.left, 0);
  await expect.poll(async () => {
    const now = Object.fromEntries((await strokeBoxes(page)).map(p => [p.kind, p.box]));
    return now.strike.left !== before.strike.left || now.strike.top !== before.strike.top;
  }).toBe(true);
  await expectAnchored(page, quotes);
  await page.screenshot({ path: "test-results/ink-landscape.png" });

  // The reading column is capped, so rotation alone mostly translates text. Split View
  // (a third of landscape) narrows the column for a real reflow: words move to other lines.
  // Offset from the paragraph's first line, so header/padding changes don't count as reflow.
  const lineOf = async (quote: string) => (await rectsOf(page, quote))[0].top - (await rectsOf(page, "The first"))[0].top;
  const tops = { strike: await lineOf(TARGETS.strike), underline: await lineOf(TARGETS.underline) };
  await page.setViewportSize({ width: 438, height: 834 });
  await expect.poll(async () => (await lineOf(TARGETS.underline)) - tops.underline).toBeGreaterThan(15);
  expect((await lineOf(TARGETS.strike)) - tops.strike).toBeGreaterThan(15);
  await expect.poll(async () => { try { await expectAnchored(page, quotes); return true; } catch { return false; } }).toBe(true);
  await expectAnchored(page, quotes);
  await page.screenshot({ path: "test-results/ink-split-view.png" });
  await page.setViewportSize({ width: 1194, height: 834 });

  // Reload (draw mode off): ink renders read-only, still anchored, and touch scroll is untouched.
  await page.reload();
  await expect(page.locator(".ink-layer path[data-stroke-id]")).toHaveCount(3);
  await expect(page.getByRole("toolbar", { name: "Ink" })).toHaveCount(0);
  await expectAnchored(page, quotes);
  await expect(page.locator(".tap-select")).toHaveCSS("touch-action", "manipulation");

  // Back to portrait after reload, then erase + undo round-trips through storage.
  await page.setViewportSize({ width: 834, height: 1194 });
  await expect.poll(async () => { try { await expectAnchored(page, quotes); return true; } catch { return false; } }).toBe(true);
  await drawOn(page);
  await page.getByRole("button", { name: "Eraser" }).click();
  const strike = (await strokeBoxes(page)).find(p => p.kind === "strike")!.box;
  await pen(page, [{ x: (strike.left + strike.right) / 2, y: (strike.top + strike.bottom) / 2 }, { x: (strike.left + strike.right) / 2 + 2, y: (strike.top + strike.bottom) / 2 }]);
  await expect(page.locator(".ink-layer path[data-stroke-id]")).toHaveCount(2);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".ink-layer path[data-stroke-id]")).toHaveCount(3);
  await expect.poll(async () => (await (await request.get(`/api/annotations?key=${key}`)).json()).annotations.length).toBe(3);
});

test("draw mode leaves finger scrolling and selection gestures alone once a Pencil is seen", async ({ page, request }, info) => {
  test.skip(info.project.name !== "ipad-webkit", "iPad-only flow");
  const key = "ink-ipad-finger";
  await request.post("/api/content", { data: { key, content: PARAGRAPH } });
  await page.goto(`/?key=${key}&persist=1`);
  await drawOn(page);
  const finger = page.getByRole("switch", { name: "Finger draws" });
  // Without a Pencil, fingers draw (so the toggle is usable on phones / without Pencil)…
  await expect(finger).toHaveAttribute("aria-checked", "true");
  await expect(page.locator(".tap-select")).toHaveCSS("touch-action", "none");
  const [r] = await rectsOf(page, "milestone");
  await pen(page, [{ x: r.left, y: r.bottom + 1 }, { x: r.right, y: r.bottom + 1 }]);
  // …and the first Pencil stroke hands fingers back to scroll/pinch/select.
  await expect(finger).toHaveAttribute("aria-checked", "false");
  await expect(page.locator(".tap-select")).toHaveCSS("touch-action", "manipulation");
  // A finger touch now neither draws nor is prevented.
  const prevented = await page.evaluate(({ x, y }) => {
    const target = document.elementFromPoint(x, y)!;
    const down = new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 9, pointerType: "touch", isPrimary: true, clientX: x, clientY: y });
    target.dispatchEvent(down);
    target.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerId: 9, pointerType: "touch", isPrimary: true, clientX: x + 80, clientY: y }));
    return down.defaultPrevented;
  }, { x: r.left, y: r.top + 4 });
  expect(prevented).toBe(false);
  await expect(page.locator(".ink-layer path[data-stroke-id]")).toHaveCount(1);
  await page.getByRole("button", { name: "Done drawing" }).click();
  await expect(page.getByRole("toolbar", { name: "Ink" })).toHaveCount(0);
});
