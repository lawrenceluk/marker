/** Raw Markdown offsets are UTF-16, matching DOM Range and comment anchors. */
export type TapCandidate = { start: number; end: number; kind: string; text: string };

const boundary = /[,;:—–]/u;
const sentenceEnd = /[.!?。！？]/u;
const atomic = /\[[^\]\n]+\]\([^\)\n]+\)|\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`/gu;

function trim(source: string, start: number, end: number) {
  while (start < end && /\s/u.test(source[start])) start++;
  while (end > start && /\s/u.test(source[end - 1])) end--;
  return { start, end };
}

function protectMarkdown(source: string, start: number, end: number) {
  for (const match of source.matchAll(atomic)) {
    const a = match.index, b = a + match[0].length;
    if (start > a && start < b) start = a;
    if (end > a && end < b) end = b;
  }
  return { start, end };
}

export function tapCandidates(source: string, at: number): TapCandidate[] {
  if (!Number.isInteger(at) || at < 0 || at >= source.length) return [];
  const lineStart = source.lastIndexOf("\n", at - 1) + 1;
  const nextBreak = source.indexOf("\n", at);
  const lineEnd = nextBreak < 0 ? source.length : nextBreak;
  const line = source.slice(lineStart, lineEnd);
  const prefix = line.match(/^(?:\s{0,3}#{1,6}\s+|\s*(?:[-*+]\s+|\d+[.)]\s+|>\s*))/u)?.[0].length ?? 0;
  const bodyStart = lineStart + prefix;
  if (at < bodyStart || !source.slice(bodyStart, lineEnd).trim()) return [];
  const body = source.slice(bodyStart, lineEnd);
  const point = at - bodyStart;
  const words = [...new Intl.Segmenter(undefined, { granularity: "word" }).segment(body)]
    .filter(s => s.isWordLike)
    .map(s => ({ start: bodyStart + s.index, end: bodyStart + s.index + s.segment.length }));
  let wordIndex = words.findIndex(w => w.start <= at && at < w.end);
  if (wordIndex < 0) {
    // Emoji and other non-word graphemes are still selectable as a whole.
    const grapheme = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(body)]
      .find(s => s.index <= point && point < s.index + s.segment.length);
    if (!grapheme || /^\s+$/u.test(grapheme.segment)) return [];
    const start = bodyStart + grapheme.index;
    words.push({ start, end: start + grapheme.segment.length });
    words.sort((a, b) => a.start - b.start);
    wordIndex = words.findIndex(w => w.start === start);
  }
  const selected = words[wordIndex];
  const out: TapCandidate[] = [];
  const seen = new Set<string>();
  function add(start: number, end: number, kind: string) {
    ({ start, end } = trim(source, start, end));
    ({ start, end } = protectMarkdown(source, start, end));
    if (start < bodyStart || end > lineEnd || end <= start || !(start <= at && at < end)) return;
    const id = `${start}:${end}`;
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ start, end, kind, text: source.slice(start, end) });
  }
  add(selected.start, selected.end, "word");
  // Short nested phrases give useful intermediate sizes for the step chips.
  for (const radius of [1, 2, 3, 4]) {
    const left = words[Math.max(0, wordIndex - radius)];
    const right = words[Math.min(words.length - 1, wordIndex + radius)];
    if (!left || !right) continue;
    if (source.slice(left.start, right.end).includes("\n")) continue;
    add(left.start, right.end, "phrase");
  }
  let clauseStart = bodyStart, clauseEnd = lineEnd;
  let sentenceStart = bodyStart, sentenceStop = lineEnd;
  for (let i = bodyStart; i < at; i++) {
    if (boundary.test(source[i])) clauseStart = i + 1;
    if (sentenceEnd.test(source[i])) sentenceStart = i + 1;
  }
  for (let i = at; i < lineEnd; i++) {
    if (boundary.test(source[i])) { clauseEnd = i; break; }
  }
  for (let i = at; i < lineEnd; i++) {
    if (sentenceEnd.test(source[i])) { sentenceStop = i + 1; break; }
  }
  if (prefix) add(bodyStart, lineEnd, /^\s{0,3}#/u.test(line) ? "heading" : "list item");
  add(clauseStart, clauseEnd, "clause");
  add(sentenceStart, sentenceStop, "sentence");
  if (!prefix) add(bodyStart, lineEnd, "line");
  return out.sort((a, b) => (a.end - a.start) - (b.end - b.start) || a.start - b.start).slice(0, 15);
}

export function heuristicRanking(candidates: TapCandidate[]): number[] {
  const indexes = candidates.map((_, i) => i);
  const preferred = indexes.find(i => candidates[i].kind === "clause")
    ?? indexes.find(i => candidates[i].kind === "sentence")
    ?? indexes.find(i => ["list item", "heading", "line"].includes(candidates[i].kind))
    ?? indexes.find(i => candidates[i].kind === "phrase")
    ?? 0;
  return [preferred, ...indexes.filter(i => i !== preferred)];
}

export function tapContext(source: string, at: number): string {
  // At most two nearby sentences in either direction; hard cap before network.
  const left = [...source.slice(0, at).matchAll(/[.!?。！？]\s*/gu)].map(m => m.index + m[0].length);
  const right = [...source.slice(at).matchAll(/[.!?。！？]\s*/gu)].map(m => at + m.index + m[0].length);
  const start = Math.max(left.at(-2) ?? 0, at - 1100);
  const end = Math.min(right[1] ?? source.length, at + 1100);
  return source.slice(start, end);
}
