import assert from "node:assert/strict";
import { test } from "node:test";
import type { Element, Root } from "hast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { quoteAt } from "../app/lib/anchors";
import { commentMarkup, sourceSegments } from "../app/lib/comment-markup";
import { locateThreads, type Thread } from "../app/lib/comments";

type Span = { text: string; start: number; end: number; exact: boolean; comments?: string };

/** Render like ContentViewer and collect the source-mapped leaves sourceSelection reads. */
function spans(source: string, threads: Thread[] = []): Span[] {
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype);
  const tree = processor.runSync(processor.parse(source)) as Root;
  commentMarkup(source, locateThreads(source, threads))()(tree);
  const out: Span[] = [];
  (function walk(node: Root | Element) {
    for (const child of node.children) {
      if (child.type !== "element") continue;
      const p = child.properties;
      if (p["data-source-start"] !== undefined)
        out.push({
          text: child.children.map((c) => (c.type === "text" ? c.value : "")).join(""),
          start: Number(p["data-source-start"]),
          end: Number(p["data-source-end"]),
          exact: p["data-source-exact"] === "true",
          ...(p["data-comments"] ? { comments: String(p["data-comments"]) } : {}),
        });
      else walk(child);
    }
  })(tree);
  return out;
}

/** Mirror sourceSelection: map a rendered-text selection to raw source offsets, or null. */
function select(list: Span[], rendered: string): { start: number; end: number } | null {
  const text = list.map((s) => s.text).join("");
  const from = text.indexOf(rendered);
  assert.notEqual(from, -1, `"${rendered}" is rendered`);
  function offset(at: number, isEnd: boolean) {
    let base = 0;
    for (const span of list) {
      const inside = isEnd ? at > base && at <= base + span.text.length : at >= base && at < base + span.text.length;
      if (inside) {
        const local = at - base;
        if (span.exact) return span.start + local;
        if (local === 0) return span.start;
        if (local === span.text.length) return span.end;
        return null;
      }
      base += span.text.length;
    }
    return null;
  }
  const start = offset(from, false), end = offset(from + rendered.length, true);
  return start === null || end === null ? null : { start, end };
}

function thread(source: string, start: number, end: number): Thread {
  return { id: "t1", anchor: quoteAt(source, start, end), created_rev: 1, resolved: false, messages: [] };
}

test("partial selections inside a multi-line block quote map to raw source", () => {
  const source = "Intro.\n\n> The first quoted line\n> and the second line\n> with a third.";
  const list = spans(source);
  for (const span of list) if (span.exact) assert.equal(source.slice(span.start, span.end), span.text);
  const range = select(list, "second line")!;
  assert.ok(range, "selection inside the quote is commentable");
  assert.equal(source.slice(range.start, range.end), "second line");
  // Across a quoted line break the anchor keeps the `> ` marker, like other Markdown syntax.
  const across = select(list, "line\nand the")!;
  assert.equal(source.slice(across.start, across.end), "line\n> and the");
});

test("bold, nested lists and nested quotes inside a quote stay anchorable", () => {
  const source = "> Keep **this bold\n> phrase** visible.\n>\n> - item one\n>   continues here\n> - item two\n>\n> > nested quote\n> > second nested";
  const list = spans(source);
  for (const span of list) if (span.exact) assert.equal(source.slice(span.start, span.end), span.text);
  for (const [rendered, raw] of [
    ["phrase", "phrase"],
    ["bold\nphrase visible", "bold\n> phrase** visible"],
    ["continues", "continues"],
    ["one\ncontinues", "one\n>   continues"],
    ["second nested", "second nested"],
  ]) {
    const range = select(list, rendered);
    assert.ok(range, `"${rendered}" is commentable`);
    assert.equal(source.slice(range.start, range.end), raw);
  }
});

test("a selection spanning the quote boundary anchors to the raw range and highlights both sides", () => {
  const source = "Before the quote.\n\n> Inside the quote\n> continues.";
  const range = select(spans(source), "quote.Inside")!;
  assert.equal(source.slice(range.start, range.end), "quote.\n\n> Inside");
  const marked = spans(source, [thread(source, range.start, range.end)]).filter((s) => s.comments);
  assert.deepEqual(marked.map((s) => s.text), ["quote.", "Inside"]);
});

test("a saved comment inside a quote highlights exactly its words after re-render", () => {
  const source = "> alpha beta\n> gamma delta";
  const start = source.indexOf("beta"), end = source.indexOf("gamma") + 5;
  const marked = spans(source, [thread(source, start, end)]).filter((s) => s.comments);
  assert.deepEqual(marked.map((s) => s.text), ["beta\n", "gamma"]);
});

test("sourceSegments falls back to one inexact segment when lines cannot be aligned", () => {
  assert.deepEqual(sourceSegments("a &amp; b", "a & b", 0, 9), [{ value: "a & b", start: 0, end: 9, exact: false }]);
  assert.deepEqual(sourceSegments("x\n> &amp;", "x\n&", 0, 9), [{ value: "x\n&", start: 0, end: 9, exact: false }]);
});
