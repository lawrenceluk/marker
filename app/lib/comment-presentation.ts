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
/** Right of the last visual line, never the union box of a multiline selection. */
export function selectionBubble(
  rects: Rect[],
  width: number,
  height: number,
  touch = false,
) {
  const rect = rects
    .filter((r) => r.right > r.left && r.bottom > r.top)
    .sort((a, b) =>
      Math.abs(a.bottom - b.bottom) < 2
        ? b.right - a.right
        : b.bottom - a.bottom,
    )[0];
  if (!rect) return null;
  const size = touch ? 28 : 24,
    gap = touch ? 14 : 4;
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
