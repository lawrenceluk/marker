import type { Root, Element as HastElement, Text, RootContent } from "hast";
import type { LocatedThread } from "./comments";

/** Preserve source positions through rendering; formatting delimiters stay in the anchor. */
export function commentMarkup(source: string, comments: LocatedThread[]) {
  return () => (tree: Root) => {
    function walk(parent: Root | HastElement) {
      parent.children = parent.children.flatMap((node): RootContent[] => {
        if (node.type === "element") {
          walk(node);
          return [node];
        }
        if (node.type !== "text") return [node];
        const start = node.position?.start.offset,
          end = node.position?.end.offset;
        if (start === undefined || end === undefined) return [node];
        const exact = source.slice(start, end) === node.value;
        const intersecting = comments.filter(
          (t) =>
            !t.resolved &&
            t.location.state === "attached" &&
            t.location.start < end &&
            t.location.end > start,
        );
        const cuts = new Set([0, node.value.length]);
        if (exact)
          for (const t of intersecting)
            if (t.location.state === "attached") {
              cuts.add(Math.max(0, t.location.start - start));
              cuts.add(Math.min(node.value.length, t.location.end - start));
            }
        const points = [...cuts].sort((a, b) => a - b);
        return points.slice(0, -1).map((from, index): HastElement => {
          const to = points[index + 1];
          const rawStart = exact ? start + from : start,
            rawEnd = exact ? start + to : end;
          const ids = intersecting
            .filter(
              (t) =>
                t.location.state === "attached" &&
                t.location.start < rawEnd &&
                t.location.end > rawStart,
            )
            .map((t) => t.id);
          return {
            type: "element",
            tagName: ids.length ? "mark" : "span",
            properties: {
              "data-source-start": rawStart,
              "data-source-end": rawEnd,
              "data-source-exact": String(exact),
              ...(ids.length ? { "data-comments": ids.join(" ") } : {}),
            },
            children: [
              { type: "text", value: node.value.slice(from, to) } as Text,
            ],
          };
        });
      });
    }
    walk(tree);
  };
}

export function sourceSelection(
  root: HTMLElement,
): { start: number; end: number } | null {
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  function offset(node: Node, at: number): number | null {
    const element = (
      node.nodeType === Node.ELEMENT_NODE
        ? (node as Element)
        : node.parentElement
    ) as HTMLElement | null;
    const span = element?.closest<HTMLElement>("[data-source-start]");
    if (!span || !root.contains(span)) return null;
    const prefix = document.createRange();
    prefix.selectNodeContents(span);
    prefix.setEnd(node, at);
    const renderedOffset = prefix.toString().length;
    if (span.dataset.sourceExact === "true")
      return Number(span.dataset.sourceStart) + renderedOffset;
    if (renderedOffset === 0) return Number(span.dataset.sourceStart);
    if (renderedOffset === span.textContent?.length)
      return Number(span.dataset.sourceEnd);
    return null; // Partial selection through decoded entities/escapes needs a richer source map.
  }
  const start = offset(range.startContainer, range.startOffset),
    end = offset(range.endContainer, range.endOffset);
  return start === null || end === null || end <= start ? null : { start, end };
}

/** Map a tap on rendered text to a raw source position without splitting a link or entity. */
export function tapSourceOffset(root: HTMLElement, x: number, y: number, source: string): number | null {
  const doc = document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null };
  const caret = document.caretPositionFromPoint?.(x, y);
  const range = caret ? null : doc.caretRangeFromPoint?.(x, y);
  const node = caret?.offsetNode ?? range?.startContainer;
  const offset = caret?.offset ?? range?.startOffset;
  if (!node || offset === undefined) return null;
  const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
  const span = element?.closest<HTMLElement>("[data-source-start]");
  if (!span || !root.contains(span)) return null;
  const start = Number(span.dataset.sourceStart), end = Number(span.dataset.sourceEnd);
  if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) return null;
  const rendered = Math.min(offset, span.textContent?.length ?? offset);
  if (span.dataset.sourceExact === "true") return Math.min(end - 1, start + rendered);
  const raw = source.slice(start, end);
  const link = raw.match(/^\[([^\]]+)\]\([^)]+\)$/u);
  if (link && link[1] === span.textContent) return Math.min(end - 1, start + 1 + rendered);
  return start;
}

/** Render a raw anchor as the live native selection used by the comment composer. */
export function selectSourceRange(root: HTMLElement, start: number, end: number): Range | null {
  const spans = [...root.querySelectorAll<HTMLElement>("[data-source-start]")];
  const first = spans.find(span => Number(span.dataset.sourceEnd) > start && Number(span.dataset.sourceStart) < end);
  const last = spans.findLast(span => Number(span.dataset.sourceEnd) > start && Number(span.dataset.sourceStart) < end);
  if (!first?.firstChild || !last?.firstChild) return null;
  const range = document.createRange();
  const firstOffset = first.dataset.sourceExact === "true"
    ? Math.max(0, Math.min(first.firstChild.textContent?.length ?? 0, start - Number(first.dataset.sourceStart))) : 0;
  const lastOffset = last.dataset.sourceExact === "true"
    ? Math.max(0, Math.min(last.firstChild.textContent?.length ?? 0, end - Number(last.dataset.sourceStart)))
    : last.firstChild.textContent?.length ?? 0;
  range.setStart(first.firstChild, firstOffset);
  range.setEnd(last.firstChild, lastOffset);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  return range;
}
