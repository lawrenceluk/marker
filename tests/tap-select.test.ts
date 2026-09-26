import assert from "node:assert/strict";
import { test } from "node:test";
import { heuristicRanking, tapCandidates, tapContext } from "../app/lib/tap-select";

function candidates(source: string, needle: string) {
  const at = source.indexOf(needle);
  assert.ok(at >= 0);
  return tapCandidates(source, at);
}

test("candidate ranges stay on raw Markdown and preserve formatted atoms", () => {
  const source = "# A clear **bold claim** about [linked words](https://example.test), then a second clause.\n- A useful list item, with details.";
  for (const needle of ["bold", "linked", "useful"]) {
    const spans = candidates(source, needle);
    assert.ok(spans.length >= 4);
    assert.ok(spans.length <= 15);
    assert.equal(new Set(spans.map(c => `${c.start}:${c.end}`)).size, spans.length);
    for (const span of spans) {
      assert.equal(span.text, source.slice(span.start, span.end));
      assert.ok(span.start <= source.indexOf(needle) && source.indexOf(needle) < span.end);
      assert.ok(!/^\s|\s$/u.test(span.text));
    }
  }
  assert.equal(candidates(source, "bold")[0].text, "**bold claim**");
  assert.equal(candidates(source, "linked")[0].text, "[linked words](https://example.test)");
  assert.ok(candidates(source, "useful").some(c => c.kind === "list item"));
  assert.ok(candidates(source, "clear").some(c => c.kind === "heading"));
});

test("CJK and emoji taps never cut a UTF-16 surrogate pair", () => {
  const source = "# 東京で読む😀文章。次の文もあります。";
  for (const needle of ["東京", "😀", "文章"]) {
    const spans = candidates(source, needle);
    assert.ok(spans.length > 0);
    for (const span of spans) {
      assert.ok(!/[\uD800-\uDBFF]$/u.test(source.slice(0, span.end)));
      assert.ok(!/^[\uDC00-\uDFFF]/u.test(source.slice(span.start)));
      assert.equal(span.text, source.slice(span.start, span.end));
    }
  }
});

test("heuristic prefers a clause and clips nearby context", () => {
  const source = "Opening sentence. Here is a focused clause, and another clause worth discussing. Third sentence. Fourth sentence. Fifth sentence.";
  const spans = candidates(source, "another");
  const picked = spans[heuristicRanking(spans)[0]];
  assert.equal(picked.kind, "clause");
  assert.match(picked.text, /^and another clause/u);
  const context = tapContext(source, source.indexOf("another"));
  assert.ok(context.includes("another clause"));
  assert.ok(context.length <= 2200);
});


test("directional candidates offer a focused phrase while retaining the full sentence", () => {
  const source = "The small team carefully reviewed the release, then approved the focused staging experiment.";
  const spans = candidates(source, "reviewed");
  assert.ok(spans.some(c => c.kind === "phrase" && c.text === "reviewed the release"));
  assert.ok(spans.some(c => c.kind === "phrase" && c.text === "carefully reviewed the release"));
  assert.ok(spans.some(c => c.kind === "sentence" && c.text === source));
  assert.ok(spans.length >= 5 && spans.length <= 15);
});
