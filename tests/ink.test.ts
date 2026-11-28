import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { applyInk, blockAt, classifyStroke, exportMarkdown, exportStrokes, lineBoxes, locateStrokes, project, toFrame, type WordBox } from "../app/lib/ink";
import { startRedisRest } from "./helpers/redis-rest";

// One line of words, 20px tall, at y 100–120: "alpha beta gamma delta".
const words: WordBox[] = ["alpha", "beta", "gamma", "delta"].map((word, i) => ({ left: i * 60, right: i * 60 + 50, top: 100, bottom: 120, start: i * 6, end: i * 6 + word.length }));
const line = (y: number, x0: number, x1: number) => Array.from({ length: 12 }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / 11, y: y + (i % 2) }));
const loop = (cx: number, cy: number, rx: number, ry: number) => Array.from({ length: 30 }, (_, i) => ({ x: cx + rx * Math.cos((i / 29) * 2 * Math.PI), y: cy + ry * Math.sin((i / 29) * 2 * Math.PI) }));

test("classifies strike, underline, circle and freehand against line boxes", () => {
  const strike = classifyStroke(line(110, 60, 165), words)!;
  assert.equal(strike.kind, "strike");
  assert.deepEqual(strike.words.map(w => w.start), [6, 12]);
  const underline = classifyStroke(line(122, 0, 105), words)!;
  assert.equal(underline.kind, "underline");
  assert.deepEqual(underline.words.map(w => w.start), [0, 6]);
  const circle = classifyStroke(loop(145, 110, 35, 18), words)!;
  assert.equal(circle.kind, "circle");
  assert.deepEqual(circle.words.map(w => w.start), [12]);
  const scribble = classifyStroke([{ x: 190, y: 60 }, { x: 200, y: 105 }, { x: 205, y: 70 }], words)!;
  assert.equal(scribble.kind, "freehand");
  assert.deepEqual(scribble.words.map(w => w.start), [18]);
  assert.equal(classifyStroke(line(110, 0, 50), []), null);
});

test("re-projection follows the anchor box and splits wrapped underline/strike per line", () => {
  const box = { left: 0, top: 100, right: 100, bottom: 120 };
  const framed = toFrame(line(122, 0, 100).map(p => ({ ...p, p: 0.5 })), "underline", box);
  assert.equal(framed.frame, "box");
  const stroke = { kind: "underline" as const, frame: framed.frame, points: framed.points, box: { w: 100, h: 20, lines: 1 }, width: 3 };
  const moved = project(stroke, [{ left: 300, top: 400, right: 400, bottom: 420 }]);
  assert.equal(moved.length, 1);
  assert.ok(moved[0].every(p => p.x >= 300 && p.x <= 400 && p.y >= 420 && p.y <= 425));
  const wrapped = project(stroke, lineBoxes([{ left: 300, top: 400, right: 400, bottom: 420 }, { left: 0, top: 424, right: 40, bottom: 444 }]));
  assert.equal(wrapped.length, 2);
  assert.ok(wrapped[1].every(p => p.y > 444 && p.x <= 40));
});

test("validation, anchors, block ids and export", () => {
  const content = "# Title\n\nFirst paragraph here.\n\n```js\nconst x = 1;\n\nlet y;\n```\n\n- item one\n- item two\n";
  const start = content.indexOf("paragraph");
  const stroke = { id: "stroke-1", kind: "circle", color: "red", width: 3, start, end: start + 9, quote: "paragraph", frame: "box", box: { w: 80, h: 20, lines: 1 }, points: [[0, 0, 0.5], [1, 1, 0.5]], pen: true };
  const strokes = applyInk(content, [], [{ action: "add", stroke }], 1000);
  assert.equal(strokes[0].anchor.exact, "paragraph");
  assert.throws(() => applyInk(content, strokes, [{ action: "add", stroke }]), /already exists/);
  assert.throws(() => applyInk(content, [], [{ action: "add", stroke: { ...stroke, quote: "nope" } }]), /changed/);
  assert.throws(() => applyInk(content, [], [{ action: "add", stroke: { ...stroke, kind: "lasso" } }]), /kind/);
  assert.throws(() => applyInk(content, [], [{ action: "add", stroke: { ...stroke, points: [[0, 0, 2], [1, 1, 0]] } }]), /point/);
  assert.equal(applyInk(content, strokes, [{ action: "remove", id: "stroke-1" }]).length, 0);
  assert.deepEqual(blockAt(content, start), { id: "b3", line: 3, kind: "paragraph", text: "First paragraph here." });
  assert.equal(blockAt(content, content.indexOf("let y")).kind, "code");
  assert.equal(blockAt(content, content.indexOf("let y")).id, "b5");
  assert.equal(blockAt(content, content.indexOf("item two")).kind, "list");
  // An edit above the stroke re-locates it by quote; a deleted quote is reported outdated.
  const edited = "Intro.\n\n" + content;
  const [moved] = exportStrokes(edited, locateStrokes(edited, strokes));
  assert.equal(moved.quote, "paragraph");
  assert.equal(moved.block?.id, "b5");
  const [gone] = exportStrokes("nothing left", locateStrokes("nothing left", strokes));
  assert.equal(gone.state, "outdated");
  assert.equal(gone.quote, "paragraph");
  assert.equal(gone.block, null);
  assert.match(exportMarkdown([moved]), /^- Circled “paragraph” in red — block b5 \(paragraph, line 5\)/);
});

test("real Lua: ink CAS, note rev untouched, rename/delete carry it, API export", async () => {
  const fixture = await startRedisRest();
  process.env.KV_REST_API_URL = fixture.url;
  process.env.KV_REST_API_TOKEN = "synthetic";
  process.env.VERCEL_ENV = "preview";
  try {
    const notes = await import("../app/lib/notes");
    const api = await import("../app/api/annotations/route");
    const post = (body: unknown) => api.POST(new NextRequest("http://localhost/api/annotations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
    const get = (key: string, format = "") => api.GET(new NextRequest(`http://localhost/api/annotations?key=${key}${format}`));
    const content = "Keep the original Markdown as the source of truth.";
    await notes.writeNote("ink-fixture", content, { ifRev: 0, ttl: 90 });
    const start = content.indexOf("original"), end = start + "original Markdown".length;
    const stroke = { id: "abc12345", kind: "underline", color: "blue", width: 3, start, end, quote: "original Markdown", frame: "box", box: { w: 100, h: 20, lines: 1 }, points: [[0, 1.1, 0.5], [1, 1.1, 0.5]], pen: true };
    const races = await Promise.all([
      post({ key: "ink-fixture", if_ink_rev: 0, operations: [{ action: "add", stroke }] }),
      post({ key: "ink-fixture", if_ink_rev: 0, operations: [{ action: "add", stroke: { ...stroke, id: "zzz12345" } }] }),
    ]);
    assert.deepEqual(races.map(r => r.status).sort(), [200, 409]);
    assert.equal((await post({ key: "ink-fixture", operations: [] })).status, 400);
    assert.equal((await post({ key: "missing-note", if_ink_rev: 0, operations: [{ action: "clear" }] })).status, 404);
    const before = await notes.readNote("ink-fixture");
    assert.equal(before?.rev, 1, "ink writes never bump the content rev");
    const data = await (await get("ink-fixture")).json();
    assert.equal(data.ink_rev, 1);
    assert.equal(data.annotations.length, 1);
    assert.equal(data.annotations[0].quote, "original Markdown");
    assert.equal(data.annotations[0].kind, "underline");
    assert.equal(data.annotations[0].block.id, "b1");
    // Content edits keep ink; the anchor re-locates.
    await notes.writeNote("ink-fixture", "New first line.\n\n" + content, { ifRev: 1 });
    const after = await (await get("ink-fixture")).json();
    assert.equal(after.annotations[0].block.id, "b3");
    assert.equal(after.annotations[0].quote, "original Markdown");
    assert.equal(await (await get("ink-fixture", "&format=markdown")).text(), "- Underlined “original Markdown” in blue — block b3 (paragraph, line 3)\n");
    // Rename carries ink, delete removes it. Production namespace is never touched.
    assert.deepEqual(await notes.renameNote("ink-fixture", "ink-renamed"), { ok: true });
    assert.equal((await (await get("ink-renamed")).json()).annotations.length, 1);
    assert.equal(await fixture.client.exists("note:ink-renamed"), 0);
    await notes.deleteNote("ink-renamed");
    assert.equal((await get("ink-renamed")).status, 404);
  } finally {
    await fixture.close();
  }
});
