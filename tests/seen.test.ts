import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { startRedisRest } from "./helpers/redis-rest";

/**
 * "What's new": a note is new when it changed since a person last saw it. A browser (session
 * cookie, no explicit key) is a person; an explicit key is an agent. Any client may mark a
 * note seen explicitly. Notes that predate tracking never read as new.
 */
test("agent changes make notes new; a person's read, write or explicit mark makes them seen", async () => {
  const fixture = await startRedisRest();
  process.env.KV_REST_API_URL = fixture.url;
  process.env.KV_REST_API_TOKEN = "synthetic";
  process.env.VERCEL_ENV = "preview";
  try {
    const notes = await import("../app/lib/notes");
    const creators = await import("../app/lib/creators");
    const folders = await import("../app/lib/folders");
    const contentApi = await import("../app/api/content/route");
    const commentsApi = await import("../app/api/comments/route");
    const metaApi = await import("../app/api/meta/route");

    const browser = (key: string) => ({ cookie: `marker_key=${key}` });
    const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
      new NextRequest(`http://localhost${url}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });
    const agentGet = async (key: string) => (await contentApi.GET(new NextRequest(`http://localhost/api/content?key=${key}`))).json();
    const browserGet = async (key: string) => (await contentApi.GET(new NextRequest("http://localhost/api/content", { headers: browser(key) }))).json();
    const unseen = async (key: string) => (await agentGet(key)).unseen as boolean;

    // An agent creates a note in a folder: it is new, in the note, the listing and the folder count.
    const created = await (await contentApi.POST(post("/api/content", { key: "s1", content: "# Plan", creator_id: true, creator_name: "Agent runs" }))).json();
    const creatorId = created.creator_id as string;
    assert.equal(await unseen("s1"), true);
    const listing = async () => {
      const result = await creators.listCreatorNotes(creatorId, { client: "test" });
      assert.equal(result.status, "ok");
      return result.status === "ok" ? result.listing.notes : [];
    };
    const folderNew = async () => (await folders.summarizeFolders([{ id: creatorId, visitedAt: 1 }], "test"))[0]!.unseen;
    assert.deepEqual((await listing()).map(n => n.unseen), [true]);
    assert.equal(await folderNew(), 1);

    // Agent reads never advance it, and leave revision and updated_at alone.
    const before = await agentGet("s1");
    assert.equal(before.unseen, true);
    assert.equal(before.seen_rev, 0);

    // A browser read is a person looking: seen, with no revision change.
    const viewed = await browserGet("s1");
    assert.equal(viewed.unseen, false);
    assert.equal(viewed.seen_rev, 1);
    assert.equal(viewed.rev, 1);
    assert.equal(viewed.updated_at, before.updated_at);
    assert.ok(viewed.seen_at >= Date.now() - 5000);
    const seenAtAfterView = viewed.seen_at as number;
    const again = await browserGet("s1");
    assert.equal(again.seen_at, seenAtAfterView);
    assert.deepEqual((await listing()).map(n => n.unseen), [false]);
    assert.equal(await folderNew(), 0);

    // An agent edit makes it new again; a person's own edit does not.
    await contentApi.POST(post("/api/content", { key: "s1", content: "- step two", mode: "append" }));
    assert.equal(await unseen("s1"), true);
    assert.equal(await folderNew(), 1);
    await contentApi.POST(post("/api/content", { content: "# Plan, edited by hand", if_rev: 2 }, browser("s1")));
    assert.equal(await unseen("s1"), false);
    assert.equal(await folderNew(), 0);

    // Comments: an agent's comment is new; a person's comment is seen.
    const rev = (await agentGet("s1")).rev as number;
    await commentsApi.POST(post("/api/comments", { key: "s1", if_rev: rev, operations: [{ action: "create", start: 2, end: 6, text: "Ready?" }] }));
    assert.equal(await unseen("s1"), true);
    const afterComment = (await agentGet("s1")).rev as number;
    await commentsApi.POST(post("/api/comments", { if_rev: afterComment, operations: [{ action: "create", start: 2, end: 6, text: "Yes" }] }, browser("s1")));
    assert.equal(await unseen("s1"), false);

    // Any client may mark it seen explicitly (there are no accounts).
    await contentApi.POST(post("/api/content", { key: "s1", content: "- step three", mode: "append" }));
    assert.equal(await unseen("s1"), true);
    const marked = await metaApi.PATCH(new NextRequest("http://localhost/api/meta", { method: "PATCH", body: JSON.stringify({ key: "s1", seen: true }) }));
    assert.equal(marked.status, 200);
    const markedBody = await marked.json();
    assert.equal(markedBody.seen_rev, (await agentGet("s1")).rev);
    assert.equal(await unseen("s1"), false);
    assert.equal(await folderNew(), 0);
    const bad = await metaApi.PATCH(new NextRequest("http://localhost/api/meta", { method: "PATCH", body: JSON.stringify({ key: "s1", seen: false }) }));
    assert.equal(bad.status, 400);
    const missing = await metaApi.PATCH(new NextRequest("http://localhost/api/meta", { method: "PATCH", body: JSON.stringify({ key: "nope", seen: true }) }));
    assert.equal(missing.status, 404);

    // A mark names the revision a person saw: a change after it stays new, and a mark never
    // moves backwards or past the current revision.
    const patch = (body: unknown) => metaApi.PATCH(new NextRequest("http://localhost/api/meta", { method: "PATCH", body: JSON.stringify(body) }));
    const seenAt = (await agentGet("s1")).rev as number;
    await contentApi.POST(post("/api/content", { key: "s1", content: "- landed between render and mark", mode: "append" }));
    assert.equal((await (await patch({ key: "s1", seen: true, rev: seenAt })).json()).seen_rev, seenAt);
    assert.equal(await unseen("s1"), true);
    assert.equal(await folderNew(), 1);
    assert.equal((await (await patch({ key: "s1", seen: true, rev: seenAt - 1 })).json()).seen_rev, seenAt);
    const latest = (await agentGet("s1")).rev as number;
    assert.equal((await (await patch({ key: "s1", seen: true, rev: latest + 5 })).json()).seen_rev, latest);
    assert.equal(await unseen("s1"), false);
    assert.equal(await folderNew(), 0);
    assert.equal((await patch({ key: "s1", seen: true, rev: -1 })).status, 400);

    // A note created in the browser is seen from the start.
    await contentApi.POST(post("/api/content", { content: "# Mine", if_rev: 0 }, browser("s2")));
    assert.equal(await unseen("s2"), false);

    // Notes that predate tracking are not new until something changes them.
    await notes.writeNote("s3", "# Old", { ifRev: 0 });
    await fixture.client.hDel("marker-commenting-preview-v1:note:s3", ["seen_rev", "seen_at"]);
    assert.equal((await agentGet("s3")).unseen, false);
    assert.equal((await agentGet("s3")).seen_rev, null);
    await contentApi.POST(post("/api/content", { key: "s3", content: "+ new line", mode: "append" }));
    const legacy = await agentGet("s3");
    assert.equal(legacy.unseen, true);
    assert.equal(legacy.seen_rev, 1);

    // The folder's new set forgets notes that left the folder.
    await contentApi.POST(post("/api/content", { key: "s4", content: "# Leaving", creator_id: creatorId }));
    assert.equal(await folderNew(), 1);
    await metaApi.PATCH(new NextRequest("http://localhost/api/meta", { method: "PATCH", body: JSON.stringify({ key: "s4", creator_id: null }), headers: { authorization: `Bearer ${creatorId}` } }));
    assert.equal(await folderNew(), 0);

    // Renaming a new note keeps it in the folder's new set under the new key.
    const P = "marker-commenting-preview-v1:";
    const newSet = (cid: string) => `${P}cidx:${cid}:new`;
    await contentApi.POST(post("/api/content", { key: "s5", content: "# Rename me", creator_id: creatorId }));
    assert.equal(await unseen("s5"), true);
    assert.deepEqual(await fixture.client.sMembers(newSet(creators.creatorHash(creatorId))), ["s5"]);
    await contentApi.PATCH(new NextRequest("http://localhost/api/content", { method: "PATCH", body: JSON.stringify({ key: "s5", new_key: "s5-renamed" }), headers: { "content-type": "application/json" } }));
    assert.deepEqual(await fixture.client.sMembers(newSet(creators.creatorHash(creatorId))), ["s5-renamed"]);
    assert.equal(await unseen("s5-renamed"), true);
    assert.equal(await folderNew(), 1);

    // Marking seen when already fully seen does not rewrite seen_at.
    await browserGet("s5-renamed");
    const stamped = (await agentGet("s5-renamed")).seen_at as number;
    await metaApi.PATCH(new NextRequest("http://localhost/api/meta", { method: "PATCH", body: JSON.stringify({ key: "s5-renamed", seen: true, rev: (await agentGet("s5-renamed")).rev }) }));
    assert.equal((await agentGet("s5-renamed")).seen_at, stamped);
  } finally {
    await fixture.close();
  }
});
