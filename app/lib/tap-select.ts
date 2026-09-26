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
    if (start < bodyStart || end > lineEnd || end <= start || end - start > 700 || !(start <= at && at < end)) return;
    const id = `${start}:${end}`;
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ start, end, kind, text: source.slice(start, end) });
  }
  let clauseStart = bodyStart, clauseEnd = lineEnd;
  let sentenceStart = bodyStart, sentenceStop = lineEnd;
  for (let i = bodyStart; i < at; i++) {
    if (boundary.test(source[i]) || sentenceEnd.test(source[i])) clauseStart = i + 1;
    if (sentenceEnd.test(source[i])) sentenceStart = i + 1;
  }
  for (let i = at; i < lineEnd; i++) {
    if (boundary.test(source[i]) || sentenceEnd.test(source[i])) { clauseEnd = i + (sentenceEnd.test(source[i]) ? 1 : 0); break; }
  }
  for (let i = at; i < lineEnd; i++) {
    if (sentenceEnd.test(source[i])) { sentenceStop = i + 1; break; }
  }
  add(selected.start, selected.end, "word");
  // Directional windows let Jev choose the meaningful noun/verb phrase instead
  // of forcing a symmetric fragment or a whole sentence.
  const phraseWords = words.filter(w => w.start >= clauseStart && w.end <= clauseEnd);
  const focus = phraseWords.findIndex(w => w.start === selected.start);
  if (focus >= 0) for (const radius of [1, 2]) {
    const left = phraseWords[Math.max(0, focus - radius)];
    const right = phraseWords[Math.min(phraseWords.length - 1, focus + radius)];
    add(left.start, selected.end, "phrase");
    add(selected.start, right.end, "phrase");
    add(left.start, right.end, "phrase");
  }
  if (focus >= 0) {
    const left1 = phraseWords[Math.max(0, focus - 1)];
    const left2 = phraseWords[Math.max(0, focus - 2)];
    const right1 = phraseWords[Math.min(phraseWords.length - 1, focus + 1)];
    const right2 = phraseWords[Math.min(phraseWords.length - 1, focus + 2)];
    add(left1.start, right2.end, "phrase");
    add(left2.start, right1.end, "phrase");
    add(phraseWords[Math.max(0, focus - 3)].start, phraseWords[Math.min(phraseWords.length - 1, focus + 3)].end, "phrase");
  }
  if (prefix) add(bodyStart, lineEnd, /^\s{0,3}#/u.test(line) ? "heading" : "list item");
  add(clauseStart, clauseEnd, "clause");
  add(sentenceStart, sentenceStop, "sentence");
  if (!prefix) add(bodyStart, lineEnd, "line");
  return out.sort((a, b) => (a.end - a.start) - (b.end - b.start) || a.start - b.start).slice(0, 15);
}

const dangling = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with"]);

function words(text: string): string[] {
  const visible = text.replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1").replace(/[*_`]/gu, "");
  return [...new Intl.Segmenter(undefined, { granularity: "word" }).segment(visible)]
    .filter(part => part.isWordLike).map(part => part.segment.toLocaleLowerCase());
}

function plausiblePhrase(candidate: TapCandidate): boolean {
  const terms = words(candidate.text);
  return candidate.kind === "phrase" && terms.length >= 2 && terms.length <= 6 &&
    candidate.text.length <= 90 && !dangling.has(terms[0]) && !dangling.has(terms.at(-1)!);
}

function focusedPhrase(candidates: TapCandidate[]): number | undefined {
  return candidates.map((candidate, index) => ({ candidate, index, terms: words(candidate.text) }))
    .filter(({ candidate }) => plausiblePhrase(candidate))
    .sort((a, b) => Math.abs(a.terms.length - 4) - Math.abs(b.terms.length - 4) ||
      b.terms.length - a.terms.length || a.index - b.index)[0]?.index;
}

/** Prefer a focused quote unless the clause is already a short complete thought. */
export function heuristicRanking(candidates: TapCandidate[]): number[] {
  const indexes = candidates.map((_, i) => i);
  const clause = indexes.find(i => candidates[i].kind === "clause");
  const shortClause = clause !== undefined && words(candidates[clause].text).length <= 6 && candidates[clause].text.length <= 70
    ? clause : undefined;
  const preferred = shortClause
    ?? focusedPhrase(candidates)
    ?? indexes.find(i => candidates[i].kind === "phrase")
    ?? clause
    ?? indexes.find(i => candidates[i].kind === "sentence")
    ?? indexes.find(i => ["list item", "heading", "line"].includes(candidates[i].kind))
    ?? indexes.find(i => candidates[i].kind === "phrase")
    ?? 0;
  return [preferred, ...indexes.filter(i => i !== preferred)];
}

/** A broad Jev choice needs a clear lead to outweigh a plausible focused phrase. */
export function calibrateJevRanking(candidates: TapCandidate[], scores: number[]): { ranking: number[]; focused: boolean } {
  const ranking = candidates.map((_, index) => index).sort((a, b) => scores[b] - scores[a] || a - b);
  const first = ranking[0];
  if (first === undefined) return { ranking, focused: false };
  const broad = candidates[first];
  if (!["clause", "sentence", "line", "list item", "heading"].includes(broad.kind) ||
    (words(broad.text).length <= 6 && broad.text.length <= 70)) return { ranking, focused: false };
  const phrases = ranking.filter(index => plausiblePhrase(candidates[index]));
  const focused = phrases[0];
  if (focused === undefined || scores[focused] < scores[first] * 0.25) return { ranking, focused: false };
  return { ranking: [focused, ...ranking.filter(index => index !== focused)], focused: true };
}

/** Chips move one distinct span size at a time; rank breaks equal-size ties. */
export function adjacentSizeCandidate(candidates: TapCandidate[], ranking: number[], current: number, direction: -1 | 1): number | undefined {
  const size = candidates[current].end - candidates[current].start;
  const eligible = ranking.filter(index => direction < 0
    ? candidates[index].end - candidates[index].start < size
    : candidates[index].end - candidates[index].start > size);
  return eligible.sort((a, b) => direction * ((candidates[a].end - candidates[a].start) - (candidates[b].end - candidates[b].start)) ||
    ranking.indexOf(a) - ranking.indexOf(b))[0];
}

export function tapContext(source: string, at: number): string {
  // At most two nearby sentences in either direction; hard cap before network.
  const left = [...source.slice(0, at).matchAll(/[.!?。！？]\s*/gu)].map(m => m.index + m[0].length);
  const right = [...source.slice(at).matchAll(/[.!?。！？]\s*/gu)].map(m => at + m.index + m[0].length);
  const start = Math.max(left.at(-2) ?? 0, at - 1100);
  const end = Math.min(right[1] ?? source.length, at + 1100);
  return source.slice(start, end);
}
