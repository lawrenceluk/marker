import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ContentViewer } from "../app/components/ContentViewer";
import { NoteCreator } from "../app/components/NoteCreator";
import { frontMatter } from "../app/lib/frontmatter";
import { flattenMetadata, INLINE_CHARS, INLINE_MAX, summarizeMetadata } from "../app/lib/metadataSummary";

const figma: { Removed: string[] } = JSON.parse(readFileSync("tests/fixtures/figma-labels.json", "utf8"));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

test("the labels the Figma board removes are gone from the app", () => {
  // app/lib/demo.ts is the text of preview's demo notes (content, not interface).
  const files = sources("app").filter(path => !path.endsWith("lib/demo.ts")).map(path => [path, readFileSync(path, "utf8")] as const);
  const hits = figma.Removed.flatMap(label => {
    // "Sort" stays as the control's accessible name; only the visible word goes.
    const pattern = label === "Sort" ? />\s*Sort\s*</ : new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    return files.filter(([, text]) => pattern.test(text)).map(([path]) => `${path}: ${label}`);
  });
  assert.deepEqual(hits, []);
});

test("front matter reads inline: the first three short single-line strings; the rest wait under 'more'", () => {
  assert.equal(INLINE_MAX, 3);
  assert.equal(INLINE_CHARS, 32);
  // The Figma example: nine fields, three inline, "6 more".
  const long = frontMatter(`---
author: agent/claude
status: draft
date: 2026-10-09
reviewers: [lawrence, agent]
sources:
  - https://example.com/economics-of-frontier-models
  - https://example.com/retries-and-rate-limiting
summary: Three talks from this week, and what each one changes for how agents write and read notes.
budget:
  q3: 12000
  q4: 18000
owner: design
---
# Body`)!;
  const summary = summarizeMetadata(long.fields!);
  assert.deepEqual(summary.inline, ["agent/claude", "draft", "2026-10-09"]);
  assert.equal(summary.more, 6);
  assert.deepEqual(summary.entries.map(e => e.key), ["author", "status", "date", "reviewers", "sources", "summary", "budget.q3", "budget.q4", "owner"]);
  assert.equal(summary.entries.find(e => e.key === "reviewers")!.value, "lawrence, agent");
  assert.equal(summary.entries.find(e => e.key === "sources")!.value, "https://example.com/economics-of-frontier-models\nhttps://example.com/retries-and-rate-limiting");

  // Short front matter is all inline: nothing waits.
  assert.deepEqual(summarizeMetadata({ status: "draft", owner: "design" }), { inline: ["draft", "design"], entries: [{ key: "status", value: "draft" }, { key: "owner", value: "design" }], more: 0 });
  // Booleans, numbers, empty, multi-line and long strings never read inline (bare "false" means nothing).
  const odd = summarizeMetadata({ ready: false, round: 2, blank: "", note: "a\nb", long: "x".repeat(INLINE_CHARS + 1), ok: "x".repeat(INLINE_CHARS) });
  assert.deepEqual(odd.inline, ["x".repeat(INLINE_CHARS)]);
  assert.equal(odd.more, 5);
  // Nesting flattens to dotted paths; empty containers say so.
  assert.deepEqual(flattenMetadata({ a: { b: [{ c: 1 }, "d"] }, e: [], f: {}, g: null }), [
    { key: "a.b.0.c", value: "1" }, { key: "a.b.1", value: "d" }, { key: "e", value: "[]" }, { key: "f", value: "{}" }, { key: "g", value: "null" },
  ]);
});

test("the note body no longer carries a metadata disclosure or an ask hint", () => {
  const html = renderToStaticMarkup(createElement(ContentViewer, { content: "---\nstatus: draft\n---\n# Plan\n\n```ask\nid: ship\nquestion: When should we ship?\ntype: single\noptions:\n- Friday\n- Next week\n```\n" }));
  assert.doesNotMatch(html, /metadata-callout|<summary|reaction-hint|Choose one/);
  assert.match(html, /<h1[^>]*>Plan<\/h1>/);
  assert.match(html, /<fieldset class="reaction-ask" aria-label="When should we ship\?">/);
});

test("the byline renders a folder with no front matter, front matter with no folder, and neither", () => {
  const byline = (info: Parameters<typeof NoteCreator>[0]["info"], content: string) =>
    renderToStaticMarkup(createElement(NoteCreator, { info, metadata: frontMatter(content), editing: false, isSaving: false, onSave: () => {}, onCancel: () => {} }));
  const folder = { hasCreator: true, name: "Design notes", tags: ["planning"], linked: true };
  const plain = byline(folder, "# No front matter");
  assert.match(plain, /class="byline-folder">Design notes</);
  assert.doesNotMatch(plain, /byline-values|byline-more/);
  const short = byline(null, "---\nstatus: draft\n---\n# Body");
  assert.match(short, /<span class="byline-values">draft<\/span>/);
  assert.doesNotMatch(short, /byline-more/);
  const onlyNumbers = byline(null, "---\nround: 2\n---\n# Body");
  assert.match(onlyNumbers, /<button[^>]*class="byline-more"[^>]*>1 field<\/button>/);
  assert.match(byline(null, "---\ntags: [unclosed\n---\n# Body"), />metadata<\/button>/);
  assert.equal(byline(null, "# Nothing"), "");
});
