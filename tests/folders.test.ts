import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { startRedisRest } from "./helpers/redis-rest";

const ALICE = "alice_folder_id_0123456789ab";
const BOB = "bob_folder_id_0123456789abcd";
const GHOST = "ghost_folder_id_0123456789ab";

test("one-off links land on /n, and remembered folders cost at most one EVAL on Home", async () => {
  const fixture = await startRedisRest();
  process.env.KV_REST_API_URL = fixture.url;
  process.env.KV_REST_API_TOKEN = "synthetic";
  process.env.VERCEL_ENV = "preview";
  try {
    const { proxy } = await import("../proxy");
    const notes = await import("../app/lib/notes");
    const { creatorHash } = await import("../app/lib/creators");
    const folders = await import("../app/lib/folders");
    const enter = await import("../app/c/enter/route");
    const switchFolder = await import("../app/c/folder/[ref]/route");
    const foldersApi = await import("../app/api/creator/folders/route");
    const contentApi = await import("../app/api/content/route");
    const session = await import("../app/api/creator/session/route");

    // `/?key=` moves the key into the session cookie and lands on `/n`, never `/`.
    const oneOff = proxy(new NextRequest("http://localhost/?key=some-note"));
    assert.equal(new URL(oneOff.headers.get("location")!).pathname, "/n");
    assert.equal(oneOff.cookies.get("marker_key")?.value, "some-note");
    // Persistent links are untouched and keep the key in the URL.
    const persist = proxy(new NextRequest("http://localhost/?key=some-note&persist=1"));
    assert.equal(persist.headers.get("location"), null);
    assert.equal(persist.cookies.get("marker_persist")?.value, "1");
    assert.equal(proxy(new NextRequest("http://localhost/n")).headers.get("Cache-Control"), "no-store, private");

    await notes.writeNote("a1", "# One", { creator: { op: "set", target: creatorHash(ALICE), proofs: [creatorHash(ALICE)], name: "Alice" } });
    await notes.writeNote("a2", "# Two", { creator: { op: "set", target: creatorHash(ALICE), proofs: [creatorHash(ALICE)] } });
    await notes.writeNote("b1", "# Bob", { creator: { op: "set", target: creatorHash(BOB), proofs: [creatorHash(BOB)] } });

    const jar = new Map<string, string>();
    const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const absorb = (response: Response & { cookies: { getAll(): { name: string; value: string }[] } }) => {
      for (const { name, value } of response.cookies.getAll()) {
        if (value) jar.set(name, value); else jar.delete(name);
      }
      return response;
    };
    const req = (path: string, init: RequestInit = {}) =>
      new NextRequest(`http://localhost${path}`, {
        ...init,
        headers: { cookie: cookieHeader(), "x-forwarded-for": "203.0.113.20", ...(init.headers ?? {}) },
      });

    // A token link remembers the folder only after the creator is confirmed.
    jar.set("marker_creator", GHOST);
    const missing = absorb(await enter.GET(req("/c/enter")));
    assert.equal(missing.headers.get("location"), "/c?error=not_found");
    assert.equal(jar.get("marker_creator"), undefined);
    assert.equal(jar.get(folders.FOLDERS_COOKIE), undefined);

    jar.set("marker_creator", ALICE);
    const entered = absorb(await enter.GET(req("/c/enter?tag=q4")));
    assert.equal(entered.headers.get("location"), "/c?tag=q4");
    assert.equal(jar.get("marker_creator"), ALICE);
    await new Promise(resolve => setTimeout(resolve, 5));
    absorb(await session.POST(req("/api/creator/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ creator_id: BOB }),
    })));
    assert.equal(jar.get("marker_creator"), BOB);

    const remembered = folders.readRememberedFolders({ get: name => jar.has(name) ? { value: jar.get(name)! } : undefined });
    assert.deepEqual(remembered.map(f => f.id), [BOB, ALICE]);

    // Home summary: one EVAL for the whole list; names, counts, newest first; no raw ids.
    fixture.commands.length = 0;
    const listed = await (await foldersApi.GET(req("/api/creator/folders"))).json();
    assert.deepEqual(fixture.commands.map(c => c[0].toUpperCase()), ["EVAL"]);
    assert.deepEqual(listed.folders.map((f: { name: string | null; count: number }) => [f.name, f.count]), [[null, 1], ["Alice", 2]]);
    const raw = JSON.stringify(listed);
    assert.ok(!raw.includes(ALICE) && !raw.includes(BOB) && !raw.includes(creatorHash(ALICE)));

    // No remembered folders: Home makes no Redis call at all.
    fixture.commands.length = 0;
    assert.deepEqual(await folders.summarizeFolders([], "203.0.113.20"), []);
    assert.deepEqual(fixture.commands, []);

    // Reopening via ref makes it active and most recent, without Redis.
    const aliceRef = listed.folders[1].ref as string;
    // A note can navigate to its remembered folder even while another folder is active.
    assert.equal(folders.noteFolderHref(creatorHash(ALICE), { get: name => jar.has(name) ? { value: jar.get(name)! } : undefined }), `/c/folder/${aliceRef}`);
    const noteMeta = await (await contentApi.GET(req("/api/content?key=a1"))).json();
    assert.equal(noteMeta.creator_linked, false); // Tag editing still needs the active credential.
    assert.equal(noteMeta.creator_folder_href, `/c/folder/${aliceRef}`);
    assert.ok(!JSON.stringify(noteMeta).includes(ALICE));
    const bare = new NextRequest("http://localhost/api/content?key=a1");
    assert.equal((await (await contentApi.GET(bare)).json()).creator_folder_href, null);
    const bearer = new NextRequest("http://localhost/api/content?key=a1", { headers: { authorization: `Bearer ${ALICE}` } });
    const bearerMeta = await (await contentApi.GET(bearer)).json();
    assert.equal(bearerMeta.creator_linked, true);
    assert.equal(bearerMeta.creator_folder_href, null); // A bearer API call doesn't create browser access.
    const emptyJar = { get: () => undefined };
    assert.equal(folders.noteFolderHref(creatorHash(ALICE), emptyJar), null);
    assert.equal(folders.noteFolderHref(null, emptyJar), null);
    assert.equal(folders.noteFolderHref(creatorHash(ALICE), { get: () => ({ value: "malformed" }) }), null);
    fixture.commands.length = 0;
    const reopened = absorb(await switchFolder.GET(req(`/c/folder/${aliceRef}`), { params: Promise.resolve({ ref: aliceRef }) }));
    assert.deepEqual(fixture.commands, []);
    assert.equal(reopened.headers.get("location"), "/c");
    assert.equal(jar.get("marker_creator"), ALICE);
    assert.equal(folders.noteFolderHref(creatorHash(ALICE), { get: name => jar.has(name) ? { value: jar.get(name)! } : undefined }), "/c");
    const filtered = await switchFolder.GET(req(`/c/folder/${aliceRef}?tag=Q4&tag=plans&token=ignored&key=ignored&next=https://example.test`), { params: Promise.resolve({ ref: aliceRef }) });
    assert.equal(filtered.headers.get("location"), "/c?tag=plans&tag=q4");
    const invalidFilter = await switchFolder.GET(req(`/c/folder/${aliceRef}?tag=bad!`), { params: Promise.resolve({ ref: aliceRef }) });
    assert.equal(invalidFilter.status, 400);
    assert.equal(invalidFilter.cookies.getAll().length, 0);
    const reordered = await (await foldersApi.GET(req("/api/creator/folders"))).json();
    assert.deepEqual(reordered.folders.map((f: { name: string | null }) => f.name), ["Alice", null]);
    const unknown = await switchFolder.GET(req("/c/folder/nope"), { params: Promise.resolve({ ref: "nope" }) });
    assert.equal(unknown.headers.get("location"), "/");

    // Forget one: gone from the list, and no longer the active folder.
    const forgot = absorb(await foldersApi.POST(req("/api/creator/folders", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `forget=${aliceRef}`,
    })));
    assert.equal(forgot.status, 303);
    assert.equal(forgot.headers.get("location"), "/");
    assert.equal(jar.get("marker_creator"), undefined);
    assert.equal(folders.noteFolderHref(creatorHash(ALICE), { get: name => jar.has(name) ? { value: jar.get(name)! } : undefined }), null);
    const forgottenLink = await switchFolder.GET(req(`/c/folder/${aliceRef}?tag=plans`), { params: Promise.resolve({ ref: aliceRef }) });
    assert.equal(forgottenLink.headers.get("location"), "/");
    const afterForget = await (await foldersApi.GET(req("/api/creator/folders"))).json();
    assert.equal(afterForget.folders.length, 1);

    // A forged cookie can't be used to probe ids: misses drop out and count toward the limit.
    const forged = [{ id: BOB, visitedAt: 2 }, ...Array.from({ length: 9 }, (_, i) => ({ id: `forged_guess_${String(i).padStart(16, "0")}`, visitedAt: 1 }))];
    const attacker = "198.51.100.40";
    for (let round = 0; round < 4; round++) {
      const summary = await folders.summarizeFolders(forged, attacker);
      assert.deepEqual(summary.map(f => f.name), [null]);
    }
    const limited = await folders.summarizeFolders(forged, attacker);
    assert.equal(limited.length, forged.length);
    assert.ok(limited.every(f => f.name === null && f.count === null));

    // The cookie caps at ten and ignores garbage.
    let list: { id: string; visitedAt: number }[] = [];
    for (let i = 0; i < 12; i++) list = folders.rememberFolder(list, `cap_test_folder_id_${String(i).padStart(8, "0")}`, i);
    assert.equal(list.length, folders.MAX_REMEMBERED_FOLDERS);
    assert.deepEqual(folders.readRememberedFolders({ get: () => ({ value: "not-json" }) }), []);
  } finally {
    await fixture.close();
  }
});
