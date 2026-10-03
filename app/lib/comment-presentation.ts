import { ogBodyText } from "./preview";

/** Display only: selections can cut off a closing Markdown delimiter. */
export function plainQuote(source: string): string {
  return ogBodyText(source, 8000)
    .replace(/(^|\s)[*_~`\[]+(?=\S)/g, "$1")
    .replace(/[*_~`\]]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

type Rect = { left: number; right: number; top: number; bottom: number };
/** Desktop: beside the last line. Touch: fit both actions clear of every line. */
export function selectionBubble(
  rects: Rect[],
  width: number,
  height: number,
  touch = false,
  viewport = { left: 0, top: 0, right: width, bottom: height },
) {
  const rect = rects
    .filter((r) => r.right > r.left && r.bottom > r.top)
    .sort((a, b) =>
      Math.abs(a.bottom - b.bottom) < 2
        ? b.right - a.right
        : b.bottom - a.bottom,
    )[0];
  if (!rect) return null;
  const size = touch ? 36 : 32,
    gap = touch ? 14 : 4;
  if (touch) {
    // Reserve the reaction bar / size chips too, so above-placement does not
    // push those controls back over the text when they open.
    const groupWidth = 208, groupHeight = 100;
    const bounds = viewport;
    const lines = rects.filter(r => r.right > r.left && r.bottom > r.top);
    const clampX = (x: number) => Math.max(bounds.left + 4, Math.min(x, bounds.right - groupWidth - 4));
    const bottom = Math.max(...lines.map(r => r.bottom));
    const top = Math.min(...lines.map(r => r.top));
    // Prefer below all selected text, away from iOS's native callout above.
    // Edge candidates find free space for selections near the viewport bottom.
    // Filter after clamping: clamping a bottom placement upward can cause overlap.
    const xs = [...new Set([
      clampX(rect.right - groupWidth), bounds.left + 4, bounds.right - groupWidth - 4,
      ...lines.flatMap(r => [r.right + gap, r.left - gap - groupWidth]),
    ])];
    const ys = [...new Set([
      bottom + gap, top - gap - groupHeight,
      ...lines.flatMap(r => [r.bottom + gap, r.top - gap - groupHeight]),
      bounds.bottom - groupHeight - 4, bounds.top + 4,
    ])];
    const candidates = ys.flatMap(y => xs.map(x => ({ x, y }))).filter(p =>
      p.x >= bounds.left + 4 && p.x + groupWidth <= bounds.right - 4 &&
      p.y >= bounds.top + 4 && p.y + groupHeight <= bounds.bottom - 4 &&
      lines.every(r => p.x + groupWidth <= r.left - gap || p.x >= r.right + gap ||
        p.y + groupHeight <= r.top - gap || p.y >= r.bottom + gap),
    );
    // No safe space means no buttons, rather than covering the selection.
    return { size, candidates: candidates.map(p => {
      const above = p.y + groupHeight <= top - gap;
      return { x: p.x, y: above ? p.y + groupHeight - size : p.y, above };
    }) };
  }
  const y = Math.max(
    4,
    Math.min((rect.top + rect.bottom - size) / 2, height - size - 4),
  );
  const candidates = [
    { x: rect.right + gap, y },
    { x: rect.left - gap - size, y },
    {
      x: Math.max(4, Math.min(rect.right - size, width - size - 4)),
      y: Math.min(rect.bottom + (touch ? 20 : 4), height - size - 4),
    },
  ];
  return {
    size,
    candidates: candidates.filter(
      (p) => p.x >= 4 && p.x + size <= width - 4 && p.y >= 4,
    ),
  };
}

/** Leave rounding slack when revealing a long touch selection's final line. */
export function selectionRevealScroll(bottom: number, viewBottom: number): number {
  return Math.max(0, Math.ceil(bottom - (viewBottom - 126)));
}
