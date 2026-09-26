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
