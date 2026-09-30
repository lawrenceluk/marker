import assert from "node:assert/strict";
import { test } from "node:test";
import { bodyMarkdown, frontMatter } from "../app/lib/frontmatter.ts";
import { reactionBlocks } from "../app/lib/responses.ts";
import { ogBodyText, previewFromMarkdown } from "../app/lib/preview.ts";

test("front matter parses YAML fields and preserves every body source position", () => {
  const content = '\uFEFF---\r\nstatus: draft\r\nready: false\r\ntags: [one, two]\r\nreview:\r\n  round: 2\r\nsummary: |\r\n  Two lines\r\n  of text\r\n...\r\n# Body\r\n\r\n1. [ ] Review this\r\n';
  const metadata = frontMatter(content)!;
  assert.equal(metadata.fields?.status, "draft");
  assert.equal(metadata.fields?.ready, false);
  assert.deepEqual(metadata.fields?.tags, ["one", "two"]);
  assert.deepEqual(metadata.fields?.review, { round: 2 });
  assert.equal(metadata.fields?.summary, "Two lines\nof text\n");
  const body = bodyMarkdown(content);
  assert.equal(body.length, content.length);
  assert.equal(body.indexOf("# Body"), content.indexOf("# Body"));
  assert.equal(reactionBlocks(content)[0].offset, content.indexOf("1. [ ]"));
  assert.deepEqual(previewFromMarkdown(content), { title: "Body", description: "[ ] Review this" });
  assert.ok(!ogBodyText(content).includes("status"));
});

test("malformed, duplicate or cyclic YAML stays available as raw metadata", () => {
  for (const yaml of ['tags: [unclosed', 'status: draft\nstatus: done', 'recursive: &loop [*loop]']) {
    const content = `---\n${yaml}\n---\n# Body`;
    assert.equal(frontMatter(content)?.fields, null);
    assert.ok(bodyMarkdown(content).endsWith("# Body"));
    assert.equal(frontMatter(content)?.raw, yaml + "\n");
  }
});

test("ordinary Markdown, unclosed front matter and code fences are unchanged", () => {
  for (const content of ["---\nA paragraph\n---\nBody", "---\nstatus: draft\n# Body", "# Body\n\n---\nstatus: draft\n---", "```yaml\n---\nstatus: draft\n---\n```", "***\n---\n"]) {
    assert.equal(frontMatter(content), null);
    assert.equal(bodyMarkdown(content), content);
  }
});

test("YAML list entries never become document reaction blocks", () => {
  const content = "---\ntasks:\n- [ ] Hidden task\n---\n\n- [ ] Real task";
  assert.deepEqual(reactionBlocks(content).map(block => block.kind === "checkbox" ? block.label : "ask"), ["Real task"]);
});

test("long metadata does not consume the body preview budget", () => {
  const content = `---\nsummary: ${"x".repeat(9000)}\n---\n# Body title\n\nBody description.`;
  assert.deepEqual(previewFromMarkdown(content), { title: "Body title", description: "Body description." });
  assert.equal(ogBodyText(content), "Body title\n\nBody description.");
});
