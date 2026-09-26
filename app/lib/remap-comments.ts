import { diffChars, type Change } from "diff";
import { locate, type Anchor } from "./anchors";
import type { Thread } from "./comments";

/** Server-only: never import this diff dependency into the reader bundle. */
export function remapComments(
  before: string,
  after: string,
  threads: Thread[],
  mode: "overwrite" | "append" | "prepend" = "overwrite",
): Thread[] {
  if (before === after || !threads.length) return threads;
  // Operation-aware diffs remove ambiguity when identical text is prepended/appended.
  const equal = { value: before, added: false, removed: false };
  const changes =
    mode === "append"
      ? [
          equal,
          { value: after.slice(before.length), added: true, removed: false },
        ]
      : mode === "prepend"
        ? [
            {
              value: after.slice(0, after.length - before.length),
              added: true,
              removed: false,
            },
            equal,
          ]
        : diffChars(before, after, { timeout: 50, maxEditLength: 2048 });
  return threads.map((thread) => ({
    ...thread,
    anchor: mapAnchor(before, after, thread.anchor, changes),
  }));
}

export function mapAnchor(
  before: string,
  after: string,
  anchor: Anchor,
  changes: Pick<Change, "value" | "added" | "removed">[] | undefined,
): Anchor {
  if (anchor.position === null) return anchor; // A changed quote stays Outdated.
  const old = locate(before, anchor);
  if (!changes || old.state !== "attached") {
    const fallback = locate(after, { ...anchor, position: undefined });
    return {
      ...anchor,
      position:
        fallback.state === "attached"
          ? { start: fallback.start, end: fallback.end }
          : null,
    };
  }
  let source = 0,
    target = 0;
  for (const change of changes) {
    // value.length is UTF-16, even though jsdiff tokenizes Unicode code points.
    const length = change.value.length;
    if (
      !change.added &&
      !change.removed &&
      old.start >= source &&
      old.end <= source + length
    ) {
      const start = target + old.start - source,
        end = target + old.end - source;
      return {
        ...anchor,
        position:
          after.slice(start, end) === anchor.exact ? { start, end } : null,
      };
    }
    if (!change.added) source += length;
    if (!change.removed) target += length;
  }
  // A deletion or insertion inside the range changes the quote. Do not jump to a duplicate.
  return { ...anchor, position: null };
}
