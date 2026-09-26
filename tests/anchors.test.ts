import assert from "node:assert/strict";
import { test } from "node:test";
import { locate, quoteAt } from "../app/lib/anchors";
import { applyComments, locateThreads } from "../app/lib/comments";
import { storagePrefix } from "../app/lib/namespace";

test("source quotes survive inserted paragraphs and Markdown formatting remains exact", () => {
  const source = "# Plan\n\nMake **the launch** easier. 🚀";
  const start = source.indexOf("the launch"),
    end = start + 10;
  const anchor = quoteAt(source, start, end);
  const changed = "New introduction\n\n" + source;
  assert.deepEqual(locate(changed, anchor), {
    state: "attached",
    start: start + 18,
    end: end + 18,
    text: "the launch",
  });
  assert.equal(
    locate(source.replace("the launch", "onboarding"), anchor).state,
    "outdated",
  );
});
test("context disambiguates repeated quotes; ambiguous and deleted quotes are retained", () => {
  const source = "First apple. Second apple.";
  const anchor = quoteAt(
    source,
    source.lastIndexOf("apple"),
    source.lastIndexOf("apple") + 5,
  );
  assert.equal(locate(source, anchor).state, "attached");
  assert.deepEqual(
    locate("apple apple", { exact: "apple", prefix: "", suffix: "" }),
    { state: "outdated", text: null },
  );
  assert.equal(locate("banana", anchor).state, "outdated");
});
test("source offsets support emoji and selections across Markdown markup", () => {
  const source = "Hi 🚀 **bold** and [link](https://example.com)!";
  const anchor = quoteAt(source, 3, source.indexOf("!"));
  assert.equal(anchor.exact, "🚀 **bold** and [link](https://example.com)");
  assert.equal(locate("Intro\n" + source, anchor).state, "attached");
});
test("create, reply, resolve, reopen and outdated retain original messages", () => {
  let threads = applyComments(
    "hello world",
    [],
    [{ action: "create", start: 0, end: 5, text: "Please clarify" }],
    1,
    "You",
  );
  const id = threads[0].id;
  threads = applyComments(
    "hello world",
    threads,
    [
      { action: "reply", id, text: "Updated" },
      { action: "resolve", id },
    ],
    2,
    "Agent",
  );
  assert.deepEqual(
    threads[0].messages.map((m) => m.author),
    ["You", "Agent"],
  );
  assert.equal(threads[0].resolved, true);
  assert.equal(locateThreads("goodbye", threads)[0].location.state, "outdated");
  assert.equal(
    applyComments("goodbye", threads, [{ action: "reopen", id }], 3, "You")[0]
      .resolved,
    false,
  );
  assert.throws(() =>
    applyComments(
      "hello",
      [],
      [{ action: "create", start: 0, end: 99, text: "x" }],
      1,
      "Agent",
    ),
  );
  assert.throws(() =>
    applyComments(
      "hello",
      [],
      [{ action: "create", start: 0, end: 1, text: " " }],
      1,
      "You",
    ),
  );
  assert.throws(() =>
    applyComments("hello", threads, [{ action: "delete", id }], 3, "Agent"),
  );
});
test("every Preview uses the fixed isolated namespace, production keeps its existing keys", () => {
  assert.equal(
    storagePrefix({ VERCEL_ENV: "preview" }),
    "marker-commenting-preview-v1:",
  );
  assert.equal(storagePrefix({ VERCEL_ENV: "production" }), "");
  assert.equal(storagePrefix({}), "");
});
