import assert from "node:assert/strict";
import { test } from "node:test";
import { locate, quoteAt } from "../app/lib/anchors";
import { applyComments, locateThreads } from "../app/lib/comments";
import { mapAnchor, remapComments } from "../app/lib/remap-comments";
import { plainQuote, selectionBubble, selectionRevealScroll } from "../app/lib/comment-presentation";

const repeated =
  "first: same phrase\nsecond: same phrase\nthird: same phrase\nfourth: same phrase";
function third() {
  const start = repeated.indexOf("same phrase", repeated.indexOf("third:"));
  return applyComments(
    repeated,
    [],
    [{ action: "create", start, end: start + 11, text: "The third one" }],
    1,
    "You",
  );
}
test("third repeated phrase survives edits before, between and after the occurrences", () => {
  const next =
    "Intro 🚀\n" +
    repeated
      .replace("second:", "a longer second:")
      .replace("\nthird:", "\nNew paragraph\nthird:") +
    "\nAfterword";
  const [thread] = remapComments(repeated, next, third());
  assert.deepEqual(locate(next, thread.anchor), {
    state: "attached",
    start: next.indexOf("same phrase", next.indexOf("third:")),
    end: next.indexOf("same phrase", next.indexOf("third:")) + 11,
    text: "same phrase",
  });
});
test("editing the selected occurrence becomes sticky Outdated instead of jumping to a duplicate", () => {
  const changed = repeated.replace(
    "third: same phrase",
    "third: revised phrase",
  );
  const result = remapComments(repeated, changed, third());
  assert.equal(result[0].anchor.position, null);
  assert.equal(locateThreads(changed, result)[0].location.state, "outdated");
  assert.equal(
    locateThreads(repeated, remapComments(changed, repeated, result))[0]
      .location.state,
    "outdated",
  );
});
test("identical prepend/append and boundary insertion preserve the original occurrence", () => {
  const source = "same phrase same phrase same phrase";
  const start = source.lastIndexOf("same phrase");
  const threads = applyComments(
    source,
    [],
    [{ action: "create", start, end: start + 11, text: "Third" }],
    1,
    "You",
  );
  const added = "same phrase ";
  assert.equal(
    remapComments(source, added + source, threads, "prepend")[0].anchor.position
      ?.start,
    start + added.length,
  );
  assert.equal(
    remapComments(source, source + added, threads, "append")[0].anchor.position
      ?.start,
    start,
  );
  const quote = quoteAt("Hello 🌍 world", 6, 8);
  const boundary = remapComments("Hello 🌍 world", "Hello new 🌍! world", [
    { ...threads[0], anchor: quote },
  ])[0];
  assert.deepEqual(boundary.anchor.position, { start: 10, end: 12 });
});
test("legacy or unmappable anchors fall back to quotes; partial quoted-span changes do not", () => {
  const legacy = { ...third()[0].anchor };
  delete legacy.position;
  const updated = "Intro\n" + repeated;
  assert.equal(
    mapAnchor(repeated, updated, legacy, undefined).position?.start,
    updated.indexOf("same phrase", updated.indexOf("third:")),
  );
  assert.equal(
    mapAnchor(repeated, "nothing remains", legacy, undefined).position,
    null,
  );
  const source = "A distinctive phrase Z";
  const threads = applyComments(
    source,
    [],
    [{ action: "create", start: 2, end: 20, text: "x" }],
    1,
    "Agent",
  );
  assert.equal(
    remapComments(source, "A distinctive NEW phrase Z", threads)[0].anchor
      .position,
    null,
  );
});
test("new comments can address identical repeated passages with no unique quote context", () => {
  const source = "phrase ".repeat(60),
    start = 210;
  const threads = applyComments(
    source,
    [],
    [{ action: "create", start, end: start + 6, text: "This one" }],
    1,
    "You",
  );
  assert.equal(locateThreads(source, threads)[0].location.state, "attached");
  assert.deepEqual(threads[0].anchor.position, { start, end: start + 6 });
});
test("quote labels are plaintext, including selections ending inside formatting", () => {
  assert.equal(plainQuote("Try **a little text"), "Try a little text");
  assert.equal(
    plainQuote("Try **bold** and [this link](https://example.com)"),
    "Try bold and this link",
  );
  assert.equal(plainQuote("Some `code"), "Some code");
  assert.equal(plainQuote("2 * 3 and snake_case"), "2 * 3 and snake_case");
});
test("bubble uses bottom-right visual rect, centers at text height, flips at viewport edges", () => {
  const rects = [
    { left: 10, right: 200, top: 10, bottom: 30 },
    { left: 10, right: 80, top: 30, bottom: 50 },
    { left: 10, right: 60, top: 30, bottom: 50 },
  ];
  assert.deepEqual(selectionBubble(rects, 300, 200)?.candidates[0], {
    x: 84,
    y: 24,
  });
  assert.equal(selectionBubble(rects, 300, 200)?.size, 32);
  assert.deepEqual(
    selectionBubble([{ left: 230, right: 298, top: 10, bottom: 30 }], 300, 200)
      ?.candidates[0],
    { x: 194, y: 4 },
  );
  assert.deepEqual(
    selectionBubble([{ left: 2, right: 298, top: 10, bottom: 30 }], 300, 200)
      ?.candidates[0],
    { x: 264, y: 34 },
  );
  assert.deepEqual(selectionBubble(rects, 300, 200, true)?.candidates[0], { x: 4, y: 64, above: false });
});

test("touch actions fit as a pair, avoid all selection rects, and respect visual viewport", () => {
  for (const rects of [
    [{ left: 10, right: 298, top: 10, bottom: 30 }],
    [{ left: 2, right: 298, top: 160, bottom: 180 }],
    [{ left: 10, right: 290, top: 130, bottom: 150 }, { left: 10, right: 280, top: 150, bottom: 170 }],
  ]) {
    const bubble = selectionBubble(rects, 300, 200, true)!;
    assert.ok(bubble.candidates.length);
    for (const p of bubble.candidates) {
      const top = "above" in p && p.above ? p.y - 64 : p.y;
      assert.ok(p.x >= 4 && p.x + 208 <= 296);
      assert.ok(top >= 4 && top + 100 <= 196);
      assert.ok(rects.every(r => p.x + 208 <= r.left || p.x >= r.right || top + 100 <= r.top || top >= r.bottom));
    }
  }
  assert.deepEqual(selectionBubble([{ left: 0, right: 300, top: 0, bottom: 200 }], 300, 200, true)!.candidates, []);
  const viewport = { left: 20, right: 280, top: 20, bottom: 200 };
  const bubble = selectionBubble([{ left: 50, right: 200, top: 30, bottom: 50 }], 300, 200, true, viewport)!;
  assert.ok(bubble.candidates.length);
  for (const p of bubble.candidates) {
    assert.ok(p.x >= 24 && p.x + 208 <= 276);
    assert.ok(p.y >= 24 && p.y + 100 <= 196);
  }
});

test("long-selection reveal leaves space despite fractional scroll rounding", () => {
  for (const bottom of [546, 546.5, 546.9, 1300.4]) {
    const scroll = selectionRevealScroll(bottom, 664);
    assert.ok(scroll > 0);
    // Even one pixel less than the requested scroll must leave safe clearance.
    const bubble = selectionBubble([{ left: 2, right: 388, top: -300 - scroll, bottom: bottom - scroll + 1 }], 390, 664, true)!;
    assert.ok(bubble.candidates.length);
    assert.equal("above" in bubble.candidates[0] && bubble.candidates[0].above, false);
  }
});
