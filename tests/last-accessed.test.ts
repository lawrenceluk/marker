import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { startRedisRest } from "./helpers/redis-rest";

test("reads throttle access, preserve revisions and expiry, and migrate legacy notes", async () => {
  const fixture = await startRedisRest();
  process.env.KV_REST_API_URL = fixture.url;
  process.env.KV_REST_API_TOKEN = "synthetic";
  process.env.VERCEL_ENV = "preview";
  try {
    const notes = await import("../app/lib/notes");
    const contentApi = await import("../app/api/content/route");
    const commentsApi = await import("../app/api/comments/route");
    const key = "marker-commenting-preview-v1:note:accessed";
    await notes.writeNote("accessed", "# A note", { ifRev: 0, ttl: 90 });
    const created = await notes.readNote("accessed");
    assert.equal(created?.lastAccessedAt, null);
    assert.equal(await notes.readRevision("accessed"), 1);
    assert.equal(await fixture.client.hGet(key, "last_accessed_at"), null);
    const beforeTtl = await fixture.client.pTTL(key);
    const get = () => contentApi.GET(new NextRequest("http://localhost/api/content?key=accessed"));
    const first = await (await get()).json();
    assert.equal(first.rev, 1);
    assert.ok(first.last_accessed_at >= Date.now() - 5000);
    assert.equal(first.updated_at, created?.updatedAt);
    await new Promise(resolve => setTimeout(resolve, 20));
    const second = await (await get()).json();
    assert.equal(second.last_accessed_at, first.last_accessed_at);
    assert.equal(await fixture.client.hGet(key, "last_accessed_at"), String(first.last_accessed_at));
    const comments = await commentsApi.GET(new NextRequest("http://localhost/api/comments?key=accessed"));
    assert.equal(comments.status, 200);
    assert.equal((await (await get()).json()).last_accessed_at, first.last_accessed_at);
    assert.equal(await notes.readRevision("accessed"), 1);
    const afterTtl = await fixture.client.pTTL(key);
    assert.ok(afterTtl > 0 && afterTtl <= beforeTtl);

    await fixture.client.hSet(key, "last_accessed_at", String(first.last_accessed_at - 3_600_001));
    const refreshed = await (await get()).json();
    assert.ok(refreshed.last_accessed_at > first.last_accessed_at - 3_600_001);
    assert.equal(refreshed.rev, 1);
    assert.equal(refreshed.updated_at, created?.updatedAt);
    assert.equal((await notes.writeNote("accessed", "Updated", { ifRev: 1 })).ok, true);
    assert.equal((await notes.readNote("accessed"))?.lastAccessedAt, refreshed.last_accessed_at);
    assert.equal((await notes.writeNote("accessed", "Stale", { ifRev: 1 })).ok, false);
    const missing = await (await contentApi.GET(new NextRequest("http://localhost/api/content?key=missing"))).json();
    assert.equal(missing.last_accessed_at, null);
    await notes.writeNote("comment-access", "Read this", { ifRev: 0 });
    assert.equal((await notes.readNote("comment-access"))?.lastAccessedAt, null);
    assert.equal((await commentsApi.GET(new NextRequest("http://localhost/api/comments?key=comment-access"))).status, 200);
    assert.ok((await notes.readNote("comment-access"))!.lastAccessedAt);
    assert.equal(await notes.readRevision("comment-access"), 1);

    const legacy = "marker-commenting-preview-v1:content:legacy-access";
    const hash = "marker-commenting-preview-v1:note:legacy-access";
    await fixture.client.set(legacy, "Old content", { PX: 90_000 });
    const legacyTtl = await fixture.client.pTTL(legacy);
    assert.equal((await notes.readNote("legacy-access"))?.lastAccessedAt, null);
    assert.equal(await fixture.client.exists(hash), 0);
    const legacyFirst = await (await contentApi.GET(new NextRequest("http://localhost/api/content?key=legacy-access"))).json();
    assert.equal(legacyFirst.content, "Old content");
    assert.equal(legacyFirst.rev, 0);
    assert.ok(legacyFirst.last_accessed_at >= Date.now() - 5000);
    assert.equal(await fixture.client.exists(legacy), 0);
    assert.equal(await fixture.client.hGet(hash, "last_accessed_at"), String(legacyFirst.last_accessed_at));
    const migratedTtl = await fixture.client.pTTL(hash);
    assert.ok(migratedTtl > 0 && migratedTtl <= legacyTtl);
    assert.equal((await notes.writeNote("legacy-access", "New content", { ifRev: 0 })).ok, true);
    await notes.renameNote("legacy-access", "renamed-access");
    assert.equal((await notes.readNote("renamed-access"))?.lastAccessedAt, legacyFirst.last_accessed_at);
    assert.ok((await fixture.client.pTTL("marker-commenting-preview-v1:note:renamed-access")) > 0);
  } finally {
    await fixture.close();
  }
});
