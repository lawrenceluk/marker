import { locate, quoteAt, type Anchor, type Location } from "./anchors";

/**
 * Ink annotations ("pseudo canvas"): pen or finger strokes drawn over a rendered note. Each
 * stroke is anchored to a raw-Markdown source range (the same Anchor comments use), never to
 * page pixels, and its points are stored relative to that range's box so it can be re-projected
 * after rotation, reflow or reload. Stored in the note hash field `ink` with its own `ink_rev`;
 * the note's content `rev` is untouched by ink writes.
 */
export const INK_KINDS = ["circle", "strike", "underline", "freehand"] as const;
export type InkKind = (typeof INK_KINDS)[number];
export const INK_COLORS = ["ink", "red", "blue", "green"] as const;
export type InkColor = (typeof INK_COLORS)[number];
/** box: points are fractions of the anchor box. offset: CSS px from its top-left. */
export type InkFrame = "box" | "offset";
/** [x, y, pressure 0–1]. */
export type InkPoint = [number, number, number];
export type InkStroke = {
  id: string;
  kind: InkKind;
  color: InkColor;
  width: number;
  anchor: Anchor;
  frame: InkFrame;
  /** Anchor box size and line count when drawn. */
  box: { w: number; h: number; lines: number };
  points: InkPoint[];
  pen: boolean;
  created_at: number;
};
export type LocatedStroke = InkStroke & { location: Location };
export type InkDoc = { strokes: InkStroke[] };
export type InkOperation =
  | { action: "add"; stroke: Omit<InkStroke, "anchor" | "created_at"> & { start: number; end: number; quote: string } }
  | { action: "remove"; id: string }
  | { action: "clear" };

export const MAX_STROKES = 300;
export const MAX_POINTS = 1500;
export const MAX_INK_BYTES = 512 * 1024;
const ID = /^[A-Za-z0-9_-]{6,64}$/;

export function parseInk(raw: string | null | undefined): InkStroke[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as InkDoc;
    return Array.isArray(parsed?.strokes) ? parsed.strokes : [];
  } catch {
    return [];
  }
}

const finite = (value: unknown, min: number, max: number) =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
const round = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places;

/** Validate before any write; throws a user-facing message. */
export function applyInk(content: string, strokes: InkStroke[], operations: unknown, now = Date.now()): InkStroke[] {
  if (!Array.isArray(operations) || !operations.length || operations.length > 50) throw new Error("Provide 1–50 operations");
  let next = strokes.slice();
  for (const op of operations as InkOperation[]) {
    if (!op || typeof op !== "object") throw new Error("Invalid operation");
    if (op.action === "clear") next = [];
    else if (op.action === "remove") {
      if (typeof op.id !== "string") throw new Error("Invalid stroke id");
      next = next.filter(stroke => stroke.id !== op.id);
    } else if (op.action === "add") {
      const s = op.stroke;
      if (!s || typeof s !== "object") throw new Error("Invalid stroke");
      if (typeof s.id !== "string" || !ID.test(s.id)) throw new Error("Invalid stroke id");
      if (next.some(stroke => stroke.id === s.id)) throw new Error("Stroke already exists");
      if (!INK_KINDS.includes(s.kind)) throw new Error("Invalid stroke kind");
      if (!INK_COLORS.includes(s.color)) throw new Error("Invalid stroke colour");
      if (s.frame !== "box" && s.frame !== "offset") throw new Error("Invalid stroke frame");
      if (!finite(s.width, 1, 40)) throw new Error("Invalid stroke width");
      if (!Number.isInteger(s.start) || !Number.isInteger(s.end) || s.start < 0 || s.end <= s.start || s.end > content.length || s.end - s.start > 4000)
        throw new Error("Invalid source range");
      if (content.slice(s.start, s.end) !== s.quote) throw new Error("The note changed under this stroke; reload and draw again");
      if (!s.box || !finite(s.box.w, 0, 1e5) || !finite(s.box.h, 0, 1e5) || !Number.isInteger(s.box.lines) || s.box.lines < 1 || s.box.lines > 200)
        throw new Error("Invalid stroke box");
      if (!Array.isArray(s.points) || s.points.length < 2 || s.points.length > MAX_POINTS) throw new Error(`Strokes need 2–${MAX_POINTS} points`);
      const points = s.points.map((point): InkPoint => {
        if (!Array.isArray(point) || point.length !== 3 || !finite(point[0], -1e4, 1e4) || !finite(point[1], -1e4, 1e4) || !finite(point[2], 0, 1))
          throw new Error("Invalid stroke point");
        return s.frame === "box" ? [round(point[0], 4), round(point[1], 4), round(point[2], 2)] : [round(point[0], 1), round(point[1], 1), round(point[2], 2)];
      });
      if (next.length >= MAX_STROKES) throw new Error(`Maximum ${MAX_STROKES} strokes per note`);
      next.push({
        id: s.id, kind: s.kind, color: s.color, width: round(s.width, 1), anchor: quoteAt(content, s.start, s.end), frame: s.frame,
        box: { w: round(s.box.w, 1), h: round(s.box.h, 1), lines: s.box.lines }, points, pen: s.pen === true, created_at: now,
      });
    } else throw new Error("Unknown operation");
  }
  if (new TextEncoder().encode(JSON.stringify({ strokes: next })).length > MAX_INK_BYTES) throw new Error("Ink exceeds 512 KiB limit");
  return next;
}

export function locateStrokes(content: string, strokes: InkStroke[]): LocatedStroke[] {
  return strokes.map(stroke => ({ ...stroke, location: locate(content, stroke.anchor) }));
}

/* ---------- Blocks: Marker has no block ids, so derive one from the current Markdown. ---------- */

export type InkBlock = { id: string; line: number; kind: "heading" | "list" | "quote" | "code" | "table" | "paragraph"; text: string };

/** The blank-line-delimited top-level block containing `offset` (fenced code kept whole). Ids are `b<line>` and are re-derived on every read. */
export function blockAt(content: string, offset: number): InkBlock {
  const lines = content.split("\n");
  const blocks: { start: number; end: number; from: number }[] = [];
  let at = 0, fence: string | null = null, current: { start: number; end: number; from: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1][0] ?? null;
    if (fence === null && !line.trim()) current = null;
    else {
      if (!current) blocks.push(current = { start: i, end: i, from: at });
      current.end = i;
      if (marker && (fence === null || marker === fence)) fence = fence === null ? marker : null;
    }
    at += line.length + 1;
  }
  const block = blocks.findLast(candidate => candidate.from <= offset) ?? blocks[0] ?? { start: 0, end: 0, from: 0 };
  const raw = lines.slice(block.start, block.end + 1).join("\n");
  const first = raw.trimStart();
  const kind: InkBlock["kind"] = /^#{1,6}\s/.test(first) ? "heading" : /^(`{3,}|~{3,})/.test(first) ? "code" : /^>/.test(first) ? "quote"
    : /^\|/.test(first) ? "table" : /^([-*+]|\d+[.)])\s/.test(first) ? "list" : "paragraph";
  const text = raw.replace(/\s+/g, " ").trim();
  return { id: `b${block.start + 1}`, line: block.start + 1, kind, text: text.length > 160 ? `${text.slice(0, 159)}…` : text };
}

/* ---------- Agent-readable export ---------- */

export type InkExport = {
  id: string;
  kind: InkKind;
  color: InkColor;
  quote: string | null;
  state: "attached" | "outdated";
  source: { start: number; end: number } | null;
  context: { prefix: string; suffix: string };
  block: InkBlock | null;
  pen: boolean;
  created_at: number;
};

export function exportStrokes(content: string, strokes: LocatedStroke[]): InkExport[] {
  return strokes.map(stroke => ({
    id: stroke.id,
    kind: stroke.kind,
    color: stroke.color,
    // Outdated marks still report what was marked, from the stored anchor.
    quote: stroke.location.state === "attached" ? stroke.location.text : stroke.anchor.exact,
    state: stroke.location.state,
    source: stroke.location.state === "attached" ? { start: stroke.location.start, end: stroke.location.end } : null,
    context: { prefix: stroke.anchor.prefix, suffix: stroke.anchor.suffix },
    block: stroke.location.state === "attached" ? blockAt(content, stroke.location.start) : null,
    pen: stroke.pen,
    created_at: stroke.created_at,
  }));
}

const VERB: Record<InkKind, string> = { circle: "Circled", strike: "Struck through", underline: "Underlined", freehand: "Drew a mark near" };

export function exportMarkdown(annotations: InkExport[]): string {
  if (!annotations.length) return "No ink annotations.\n";
  return annotations.map(a => {
    const where = a.block ? ` — block ${a.block.id} (${a.block.kind}, line ${a.block.line})` : " — text no longer in the note";
    const quote = a.quote ?? a.context.prefix.slice(-20) + "…" + a.context.suffix.slice(0, 20);
    return `- ${VERB[a.kind]} “${quote.replace(/\s+/g, " ")}” in ${a.color}${where}`;
  }).join("\n") + "\n";
}

/* ---------- Geometry: shared by the browser layer and unit tests. ---------- */

export type Box = { left: number; top: number; right: number; bottom: number };
/** A word on screen with its raw-source range. */
export type WordBox = Box & { start: number; end: number };
export type Classified = { kind: InkKind; words: WordBox[] };

const width = (b: Box) => b.right - b.left;
const height = (b: Box) => b.bottom - b.top;

export function boundsOf(points: { x: number; y: number }[]): Box {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const p of points) { left = Math.min(left, p.x); right = Math.max(right, p.x); top = Math.min(top, p.y); bottom = Math.max(bottom, p.y); }
  return { left, top, right, bottom };
}

function insidePolygon(x: number, y: number, polygon: { x: number; y: number }[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Classify a stroke by its geometry relative to the text line boxes under it.
 * - strike: a flat stroke through the middle band of a line of words
 * - underline: a flat stroke just below a line of words
 * - circle: a closed loop; anchors the words whose centres fall inside it
 * - freehand: anything else; anchors the words its box touches, else the nearest word
 * Returns null when there is no text to anchor to.
 */
export function classifyStroke(points: { x: number; y: number }[], words: WordBox[]): Classified | null {
  if (points.length < 2 || !words.length) return null;
  const b = boundsOf(points);
  const w = width(b), h = height(b);
  const lineHeight = median(words.map(height)) || 20;
  let length = 0;
  for (let i = 1; i < points.length; i++) length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  const gap = Math.hypot(points[0].x - points.at(-1)!.x, points[0].y - points.at(-1)!.y);
  const sorted = (list: WordBox[]) => list.slice().sort((x, y) => x.start - y.start);

  if (h <= 0.75 * lineHeight && w >= Math.max(12, 2 * h)) {
    const midY = (b.top + b.bottom) / 2;
    const covered = words.filter(word => {
      const overlap = Math.min(word.right, b.right) - Math.max(word.left, b.left);
      return overlap >= 0.5 * width(word);
    });
    let best: { kind: InkKind; words: WordBox[]; score: number } | null = null;
    for (const word of covered) {
      const rel = (midY - word.top) / height(word);
      const kind: InkKind | null = rel >= 0.25 && rel <= 0.75 ? "strike" : rel > 0.75 && rel <= 1.5 ? "underline" : null;
      if (!kind) continue;
      const line = covered.filter(other => Math.abs(other.top - word.top) < 0.5 * height(word));
      const score = Math.abs(rel - (kind === "strike" ? 0.5 : 1.05));
      if (!best || score < best.score) best = { kind, words: sorted(line), score };
    }
    if (best) return { kind: best.kind, words: best.words };
  }

  if (points.length >= 8 && gap <= 0.35 * Math.max(w, h) && length >= 1.2 * (w + h) && h >= 0.5 * lineHeight) {
    const inside = words.filter(word => insidePolygon((word.left + word.right) / 2, (word.top + word.bottom) / 2, points));
    if (inside.length) return { kind: "circle", words: sorted(inside) };
  }

  const touching = words.filter(word => word.left < b.right && word.right > b.left && word.top < b.bottom && word.bottom > b.top);
  if (touching.length) return { kind: "freehand", words: sorted(touching) };
  const cx = (b.left + b.right) / 2, cy = (b.top + b.bottom) / 2;
  const nearest = words.reduce((best, word) => {
    const d = Math.hypot(Math.max(word.left - cx, 0, cx - word.right), Math.max(word.top - cy, 0, cy - word.bottom));
    return d < best.d ? { word, d } : best;
  }, { word: words[0], d: Infinity });
  return { kind: "freehand", words: [nearest.word] };
}

/** Group rects into visual lines (same row), returning one box per line, top to bottom. */
export function lineBoxes(rects: Box[]): Box[] {
  const lines: Box[] = [];
  for (const rect of rects.filter(r => width(r) > 0.5 && height(r) > 0.5).sort((a, b) => a.top - b.top || a.left - b.left)) {
    const line = lines.find(l => Math.abs((l.top + l.bottom) / 2 - (rect.top + rect.bottom) / 2) < 0.5 * Math.min(height(l), height(rect)));
    if (line) { line.left = Math.min(line.left, rect.left); line.right = Math.max(line.right, rect.right); line.top = Math.min(line.top, rect.top); line.bottom = Math.max(line.bottom, rect.bottom); }
    else lines.push({ ...rect });
  }
  return lines;
}

export function unionBox(boxes: Box[]): Box | null {
  if (!boxes.length) return null;
  return boxes.reduce((u, b) => ({ left: Math.min(u.left, b.left), top: Math.min(u.top, b.top), right: Math.max(u.right, b.right), bottom: Math.max(u.bottom, b.bottom) }));
}

/** Normalise layer-space points into the stroke's anchor frame. */
export function toFrame(points: { x: number; y: number; p: number }[], kind: InkKind, box: Box): { frame: InkFrame; points: InkPoint[] } {
  const frame: InkFrame = kind === "freehand" ? "offset" : "box";
  const w = Math.max(1, width(box)), h = Math.max(1, height(box));
  return {
    frame,
    points: points.map(p => frame === "box"
      ? [round((p.x - box.left) / w, 4), round((p.y - box.top) / h, 4), round(p.p, 2)]
      : [round(p.x - box.left, 1), round(p.y - box.top, 1), round(p.p, 2)]),
  };
}

/**
 * Re-project a stored stroke onto the anchor's current line boxes (layer space). Returns one or
 * more point runs. Underline/strike that now wrap onto a different number of lines are redrawn
 * per line so they stay on the text instead of being stretched diagonally.
 */
export function project(stroke: Pick<InkStroke, "kind" | "frame" | "points" | "box" | "width">, lines: Box[]): { x: number; y: number; p: number }[][] {
  const box = unionBox(lines);
  if (!box) return [];
  if ((stroke.kind === "underline" || stroke.kind === "strike") && lines.length !== stroke.box.lines) {
    return lines.map(line => {
      const y = stroke.kind === "strike" ? (line.top + line.bottom) / 2 : line.bottom + Math.max(1, stroke.width / 2);
      const run: { x: number; y: number; p: number }[] = [];
      for (let i = 0; i <= 8; i++) run.push({ x: line.left + (width(line) * i) / 8, y, p: 0.5 });
      return run;
    });
  }
  if (stroke.frame === "offset") return [stroke.points.map(([x, y, p]) => ({ x: box.left + x, y: box.top + y, p }))];
  const w = width(box), h = height(box);
  return [stroke.points.map(([x, y, p]) => ({ x: box.left + x * w, y: box.top + y * h, p }))];
}
