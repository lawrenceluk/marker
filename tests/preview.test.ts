import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DESCRIPTION_MAX,
  TITLE_MAX,
  previewFromMarkdown,
} from "../app/lib/preview.ts";

describe("previewFromMarkdown", () => {
  it("uses a heading as title and the following paragraph as description", () => {
    const preview = previewFromMarkdown(
      "# Meeting notes\n\nDiscussed the launch timeline and owners."
    );
    assert.deepEqual(preview, {
      title: "Meeting notes",
      description: "Discussed the launch timeline and owners.",
    });
  });

  it("strips common markdown noise from the start of a paste", () => {
    const preview = previewFromMarkdown(
      "**Hello** _world_ — see [the doc](https://example.com) and ![alt text](https://img.example/a.png).\n\n`code` plus a list:\n- one\n- two"
    );
    assert.equal(preview?.title, "Hello world — see the doc and alt text.");
    assert.equal(preview?.description, "code plus a list: one two");
  });

  it("splits a long first paragraph across title and description", () => {
    const words = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
    const preview = previewFromMarkdown(words);
    assert.ok(preview);
    assert.ok(preview.title.endsWith("…"));
    assert.ok(preview.title.length <= TITLE_MAX);
    assert.ok(preview.description.length <= DESCRIPTION_MAX);
    assert.ok(preview.description.startsWith("word"));
    assert.notEqual(preview.description, preview.title);
  });

  it("returns a title-only preview for a short one-line note", () => {
    assert.deepEqual(previewFromMarkdown("just this"), {
      title: "just this",
      description: "",
    });
  });

  it("returns null for empty or markdown-only noise", () => {
    assert.equal(previewFromMarkdown(""), null);
    assert.equal(previewFromMarkdown("   \n\n  "), null);
    assert.equal(previewFromMarkdown("***\n---\n"), null);
  });

  it("keeps fenced-code inner text so a paste of code still previews", () => {
    const preview = previewFromMarkdown("```js\nconst answer = 42;\n```");
    assert.equal(preview?.title, "const answer = 42;");
  });
});
