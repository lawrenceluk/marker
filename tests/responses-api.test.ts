import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { startRedisRest } from "./helpers/redis-rest";

const content = [
  "# Synthetic review",
  "1. [ ] Tidy desk",
  "2. [ ] Clear inbox",
  "",
  "```ask",
  "id: next-step",
  "question: What should happen next?",
  "type: multi",
  "options:",
  "- Draft a plan",
  "- Wait a week",
  "other: true",
  "```",
].join("\n");

test("response drafts, submission, conflicts and read-back share the note revision", async () => {
  const fixture = await startRedisRest();
  process.env.KV_REST_API_URL = fixture.url;
  process.env.KV_REST_API_TOKEN = "synthetic";
  process.env.VERCEL_ENV = "preview";
  try {
    const notes = await import("../app/lib/notes");
    const api = await import("../app/api/responses/route");
    const post = (body: unknown) => api.POST(new NextRequest("http://localhost/api/responses", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }));
    const get = () => api.GET(new NextRequest("http://localhost/api/responses?key=fixture"));
    await notes.writeNote("fixture", content, { ifRev: 0, ttl: 90 });
    const initial = await (await get()).json();
    assert.equal(initial.blocks.length, 3);
    assert.deepEqual(initial.responses, []);
    const check = initial.blocks[0].id;
    const ask = "ask:next-step";
    const draft = await post({ key: "fixture", if_rev: 1, changes: [
      { block_id: check, selections: ["Tidy desk"], free_text: "" },
      { block_id: ask, selections: ["Draft a plan", "Other"], free_text: "Send a short checklist" },
    ], submit: false });
    assert.equal(draft.status, 200);
    assert.equal((await draft.json()).rev, 2);
    assert.equal((await post({ key: "fixture", if_rev: 1, changes: [], submit: true })).status, 409);
    assert.equal((await post({ key: "fixture", if_rev: 2, changes: [
      { block_id: ask, selections: ["Not an option"], free_text: "" },
    ], submit: false })).status, 400);
    const submitted = await post({ key: "fixture", if_rev: 2, changes: [], submit: true });
    assert.equal(submitted.status, 200);
    const readback = await (await get()).json();
    assert.equal(readback.rev, 3);
    assert.equal(readback.responses.length, 3);
    assert.deepEqual(readback.responses.find((entry: { block_id: string }) => entry.block_id === ask).selections, ["Draft a plan", "Other"]);
    assert.equal(readback.responses.find((entry: { block_id: string }) => entry.block_id === ask).free_text, "Send a short checklist");
    assert.equal(typeof readback.responses[0].submitted_at, "number");
    assert.equal(readback.responses[0].active, true);
    assert.equal((await notes.readNote("fixture", true))?.comments.length, 0);
    assert.equal((await notes.writeNote("fixture", `${content}\n\nAgent reply`, { ifRev: 3 })).ok, true);
    assert.equal((await (await get()).json()).responses.length, 3);
    await notes.renameNote("fixture", "renamed");
    assert.equal((await notes.readNote("renamed", true))?.responses.length, 3);
    assert.equal((await get()).status, 404);
    await notes.deleteNote("renamed");
    assert.equal(await notes.readNote("renamed", true), null);
  } finally { await fixture.close(); }
});

test("ask fences stay readable Markdown and tasks inside code do not become responses", async () => {
  const { reactionBlocks } = await import("../app/lib/responses");
  assert.equal(reactionBlocks("```txt\n- [ ] code example\n```\n- [ ] Real task").length, 1);
  assert.equal(reactionBlocks("```ask\nid: x\nquestion: Choose?\noptions:\n- Yes\n- No\n```")[0].kind, "ask");
  assert.equal(reactionBlocks("```ask\nid: x\nquestion: Missing options\n```").length, 0);
});
