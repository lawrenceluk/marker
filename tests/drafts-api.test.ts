import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import type { ResponseEntry } from "../app/lib/responses";
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

test("choice drafts, removed submission, conflicts and read-back share the note revision", async () => {
  const fixture = await startRedisRest();
  process.env.KV_REST_API_URL = fixture.url;
  process.env.KV_REST_API_TOKEN = "synthetic";
  process.env.VERCEL_ENV = "preview";
  try {
    const notes = await import("../app/lib/notes");
    const api = await import("../app/api/drafts/route");
    const post = (body: unknown) => api.POST(new NextRequest("http://localhost/api/drafts", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }));
    const get = () => api.GET(new NextRequest("http://localhost/api/drafts?key=fixture"));
    await notes.writeNote("fixture", content, { ifRev: 0, ttl: 90 });
    const initial = await (await get()).json();
    assert.equal(initial.blocks.length, 3);
    assert.deepEqual(initial.responses, []);
    const firstAccess = (await notes.readNote("fixture"))?.lastAccessedAt;
    assert.ok(firstAccess);
    assert.equal(await notes.readRevision("fixture"), 1);
    const check = initial.blocks[0].id;
    const ask = "ask:next-step";
    const draft = await post({ key: "fixture", if_rev: 1, changes: [
      { block_id: check, selections: ["Tidy desk"], free_text: "" },
      { block_id: ask, selections: ["Draft a plan", "Other"], free_text: "Send a short checklist" },
     ] });
    assert.equal(draft.status, 200);
    assert.equal((await draft.json()).rev, 2);
    assert.equal((await post({ key: "fixture", if_rev: 1, changes: [{ block_id: check, selections: [], free_text: "" }] })).status, 409);
    assert.equal((await post({ key: "fixture", if_rev: 2, changes: [{ block_id: ask, selections: ["Not an option"], free_text: "" }] })).status, 400);
    for (const submit of [true, false]) assert.equal((await post({ key: "fixture", if_rev: 2, changes: [], submit })).status, 400);
    assert.equal(await notes.readRevision("fixture"), 2);
    const readback = await (await get()).json();
    assert.equal(readback.rev, 2);
    assert.equal(readback.responses.length, 2);
    assert.deepEqual(readback.responses.find((entry: { block_id: string }) => entry.block_id === ask).selections, ["Draft a plan", "Other"]);
    assert.equal(readback.responses.find((entry: { block_id: string }) => entry.block_id === ask).free_text, "Send a short checklist");
    assert.equal("submitted_at" in readback.responses[0], false);
    assert.equal(readback.responses[0].active, true);
    const contentApi = await import("../app/api/content/route");
    const contentReadback = await (await contentApi.GET(new NextRequest("http://localhost/api/content?key=fixture"))).json();
    assert.deepEqual(contentReadback.responses, (await notes.readNote("fixture", true))?.responses);
    assert.equal(contentReadback.last_accessed_at, firstAccess);
    assert.equal((await notes.readNote("fixture", true))?.comments.length, 0);
    assert.equal((await notes.writeNote("fixture", `${content}\n\nAgent reply`, { ifRev: 2 })).ok, true);
    assert.equal((await (await get()).json()).responses.length, 2);
    await notes.renameNote("fixture", "renamed");
    assert.equal((await notes.readNote("renamed", true))?.responses.length, 2);
    assert.equal((await get()).status, 404);
    // Legacy submission metadata stays stored as history; its choices still edit as drafts.
    await notes.writeNote("legacy", content, { ifRev: 0 });
    const legacyBefore = (await notes.readNote("legacy", true))!;
    await notes.commitResponses("legacy", legacyBefore, [{ block_id: ask, kind: "ask", selections: ["Wait a week"], free_text: "", updated_at: 1, submitted_at: 2 } as ResponseEntry & { submitted_at: number }]);
    const legacy = (await notes.readNote("legacy", true))!;
    assert.deepEqual(legacy.responses[0].selections, ["Wait a week"]);
    assert.equal((await notes.writeNote("legacy", `${content}\nRetain drafts`, { ifRev: legacy.rev })).ok, true);
    const edited = await post({ key: "legacy", if_rev: legacy.rev + 1, changes: [{ block_id: ask, selections: ["Draft a plan"], free_text: "" }] });
    assert.equal(edited.status, 200);
    const choice = (await edited.json()).responses[0];
    assert.deepEqual(choice.selections, ["Draft a plan"]);
    assert.equal("submitted_at" in choice, false);
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
