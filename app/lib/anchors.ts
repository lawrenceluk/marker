/** UTF-16 offsets into raw Markdown, never rendered-text offsets. */
export type Anchor = {
  exact: string;
  prefix: string;
  suffix: string;
  position?: { start: number; end: number } | null;
};
export type Location =
  | { state: "attached"; start: number; end: number; text: string }
  | { state: "outdated"; text: null };

export function quoteAt(source: string, start: number, end: number): Anchor {
  return {
    exact: source.slice(start, end),
    position: { start, end },
    prefix: source.slice(Math.max(0, start - 48), start),
    suffix: source.slice(end, end + 48),
  };
}

/** No fuzzy matching: a deleted or ambiguous quote remains in the thread list. */
export function locate(source: string, anchor: Anchor): Location {
  if (anchor.position === null) return { state: "outdated", text: null };
  const position = anchor.position;
  if (
    position &&
    Number.isInteger(position.start) &&
    Number.isInteger(position.end) &&
    position.start >= 0 &&
    position.end > position.start &&
    source.slice(position.start, position.end) === anchor.exact
  ) {
    return { state: "attached", ...position, text: anchor.exact };
  }
  const matches: number[] = [];
  if (!anchor.exact) return { state: "outdated", text: null };
  for (
    let at = source.indexOf(anchor.exact);
    at !== -1;
    at = source.indexOf(anchor.exact, at + 1)
  )
    matches.push(at);
  const contextual = matches.filter(
    (at) =>
      source.slice(Math.max(0, at - anchor.prefix.length), at) ===
        anchor.prefix &&
      source.slice(
        at + anchor.exact.length,
        at + anchor.exact.length + anchor.suffix.length,
      ) === anchor.suffix,
  );
  const at =
    matches.length === 1
      ? matches[0]
      : contextual.length === 1
        ? contextual[0]
        : undefined;
  return at === undefined
    ? { state: "outdated", text: null }
    : {
        state: "attached",
        start: at,
        end: at + anchor.exact.length,
        text: anchor.exact,
      };
}
