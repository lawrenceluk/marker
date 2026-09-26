import assert from "node:assert/strict";
import { test } from "node:test";
import { adjacentSizeCandidate, calibrateJevRanking, heuristicRanking, tapCandidates, tapContext } from "../app/lib/tap-select";

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

test("a long paragraph falls back to a focused phrase, with adjacent sizes reachable in both directions", () => {
  const source = "The small team carefully reviewed the release and considered the feedback before approving the focused staging experiment for everyone.";
  const spans = candidates(source, "reviewed");
  const ranking = heuristicRanking(spans);
  const first = spans[ranking[0]];
  assert.equal(first.kind, "phrase");
  assert.match(first.text, /reviewed/u);
  assert.ok(first.text.length < source.length / 2);
  const larger = adjacentSizeCandidate(spans, ranking, ranking[0], 1);
  assert.notEqual(larger, undefined);
  assert.equal(spans[larger!].end - spans[larger!].start,
    Math.min(...spans.filter(span => span.end - span.start > first.end - first.start).map(span => span.end - span.start)));
  const smaller = adjacentSizeCandidate(spans, ranking, ranking[0], -1);
  assert.notEqual(smaller, undefined);
  assert.equal(adjacentSizeCandidate(spans, ranking, larger!, -1), ranking[0]);
  assert.ok(spans.some(span => span.text === source), "the full context remains available through +");
});

test("short complete thoughts keep their context in the heuristic", () => {
  const source = "It was not approved.";
  const spans = candidates(source, "approved");
  assert.equal(spans[heuristicRanking(spans)[0]].text, source);
});

test("tapping an opening stopword still avoids a paragraph-sized fallback", () => {
  const source = "The committee reviewed the draft carefully and then approved several detailed changes for the staging experiment.";
  const spans = candidates(source, "The");
  const first = spans[heuristicRanking(spans)[0]];
  assert.equal(first.kind, "phrase");
  assert.ok(first.text.length < source.length / 2);
});

test("Jev's modest paragraph lead yields to a plausible phrase, but a clear full-context choice remains", () => {
  const source = "The small team carefully reviewed the release and considered the feedback before approving the focused staging experiment for everyone.";
  const spans = candidates(source, "reviewed");
  const broad = spans.findIndex(span => span.text === source);
  const phrase = spans.findIndex(span => span.text === "carefully reviewed the release");
  assert.ok(broad >= 0 && phrase >= 0);
  const scores = spans.map(() => 0.01);
  scores[broad] = 0.48;
  scores[phrase] = 0.20;
  const promoted = calibrateJevRanking(spans, scores);
  assert.equal(promoted.focused, true);
  assert.equal(promoted.ranking[0], phrase, "the former first − size becomes the initial selection");
  assert.equal(adjacentSizeCandidate(spans, promoted.ranking, phrase, 1) !== undefined, true);
  scores[broad] = 0.9;
  scores[phrase] = 0.03;
  const necessary = calibrateJevRanking(spans, scores);
  assert.equal(necessary.focused, false);
  assert.equal(necessary.ranking[0], broad);
});
