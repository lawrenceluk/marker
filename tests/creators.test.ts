import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { startRedisRest } from "./helpers/redis-rest";
import {
  generateCreatorId,
  normalizeCreatorId,
  normalizeCreatorName,
  normalizeTags,
} from "../app/lib/creatorId";

const P = "marker-commenting-preview-v1:";
const ALICE = "alice_creator_id_0123456789";
const BOB = "bob~creator-id-abcdefghijkl";

test("creator id, name and tag normalization", () => {
  assert.equal(normalizeCreatorId(`  ${ALICE} `), ALICE);
  assert.equal(normalizeCreatorId("short-id"), null);
  assert.equal(normalizeCreatorId("x".repeat(129)), null);
  assert.equal(normalizeCreatorId("has space in the middle of it"), null);
  assert.equal(normalizeCreatorId("backtick`is-not-allowed-here"), null);
  assert.equal(normalizeCreatorId(42), null);
  const generated = generateCreatorId();
  assert.equal(normalizeCreatorId(generated), generated);
  assert.equal(generated.length, 32);
  assert.notEqual(generateCreatorId(), generated);

  assert.equal(normalizeCreatorName("  Plans  "), "Plans");
  assert.equal(normalizeCreatorName("é".repeat(80)), "é".repeat(80));
  assert.equal(normalizeCreatorName("x".repeat(81)), null);
  assert.equal(normalizeCreatorName("   "), null);
  assert.equal(normalizeCreatorName("line\nbreak"), null);

  assert.deepEqual(normalizeTags([" Q4 ", "plans", "q4", "a_b-c"]), { tags: ["a_b-c", "plans", "q4"] });
  assert.deepEqual(normalizeTags(null), { tags: [] });
  assert.deepEqual(normalizeTags([]), { tags: [] });
  for (const bad of [["-lead"], ["has space"], ["x".repeat(33)], [""], [1], "plans"]) {
    assert.ok("error" in normalizeTags(bad), JSON.stringify(bad));
  }
  assert.ok("error" in normalizeTags(Array.from({ length: 11 }, (_, i) => `t${i}`)));
  assert.deepEqual(normalizeTags(Array.from({ length: 11 }, () => "same")), { tags: ["same"] });
});

test("creator index: create, retag, move, rename, delete, expiry, cap, gate and Redis cost", async () => {
  const fixture = await startRedisRest();
  process.env.KV_REST_API_URL = fixture.url;
  process.env.KV_REST_API_TOKEN = "synthetic";
  process.env.VERCEL_ENV = "preview";
  try {
    const { creatorHash, noteRef } = await import("../app/lib/creators");
    const contentApi = await import("../app/api/content/route");
    const metaApi = await import("../app/api/meta/route");
    const creatorApi = await import("../app/api/creator/route");
    const sessionApi = await import("../app/api/creator/session/route");
    const openRoute = await import("../app/c/open/[ref]/route");
    const { proxy } = await import("../proxy");

    const A = creatorHash(ALICE);
    const B = creatorHash(BOB);
    const zset = (cid: string) => `${P}cidx:${cid}`;
    const members = (cid: string) => fixture.client.zRange(zset(cid), 0, -1);
    const tagged = async (cid: string, tag: string) => (await fixture.client.sMembers(`${zset(cid)}:t:${tag}`)).sort();
    const counts = (cid: string) => fixture.client.hGetAll(`${zset(cid)}:tags`);
    const commands = () => fixture.commands.map(c => c[0].toUpperCase());
    const reset = () => { fixture.commands.length = 0; };

    const send = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
      new NextRequest(`http://localhost${path}`, {
        method,
        headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.7", ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    const post = async (body: unknown, headers?: Record<string, string>) => {
      const response = await contentApi.POST(send("POST", "/api/content", body, headers));
      return { status: response.status, body: await response.json() };
    };
    const meta = async (body: unknown, headers?: Record<string, string>) => {
      const response = await metaApi.PATCH(send("PATCH", "/api/meta", body, headers));
      return { status: response.status, body: await response.json() };
    };
    const list = async (query = "", headers: Record<string, string> = { authorization: `Bearer ${ALICE}` }) => {
      const response = await creatorApi.GET(send("GET", `/api/creator${query}`, undefined, headers));
      return { status: response.status, body: await response.json() };
    };
    const read = async (key: string, headers?: Record<string, string>) =>
      (await contentApi.GET(send("GET", `/api/content?key=${key}`, undefined, headers))).json();

    // Existing paths: same commands as before, and no index keys for creator-less notes.
    reset();
    assert.equal((await post({ key: "plain", content: "# Plain" })).status, 200);
    assert.deepEqual(commands(), ["EVAL", "EVAL"]);
    reset();
    const plain = await read("plain");
    assert.deepEqual(commands(), ["EVAL"]);
    assert.equal(plain.has_creator, false);
    assert.deepEqual(plain.tags, []);
    assert.equal(plain.creator_name, null);
    reset();
    await contentApi.PATCH(send("PATCH", "/api/content", { key: "plain", new_key: "plain2" }));
    assert.deepEqual(commands(), ["EVAL"]);
    reset();
    await contentApi.DELETE(send("DELETE", "/api/content", { key: "plain2" }));
    assert.deepEqual(commands(), ["EVAL"]);
    assert.deepEqual(await fixture.client.keys("*cidx*"), []);
    assert.equal(await fixture.client.exists(`${P}note:plain2`), 0);

    // Validation happens before any Redis call.
    reset();
    for (const body of [
      { key: "n1", content: "x", creator_id: "too-short" },
      { key: "n1", content: "x", tags: ["Bad Tag"] },
      { key: "n1", content: "x", creator_name: "Orphan name" },
      { key: "n1", content: "x", creator_id: ALICE, creator_name: "x".repeat(81) },
      { key: "n1", content: "x", creator_id: null, tags: ["a"] },
      { key: "n1", content: "x", creator_id: ALICE, tags: Array.from({ length: 11 }, (_, i) => `t${i}`) },
    ]) {
      assert.equal((await post(body)).status, 400, JSON.stringify(body));
    }
    assert.deepEqual(commands(), []);
    // Tags need a creator.
    assert.equal((await post({ key: "n1", content: "x", tags: ["a"] })).status, 400);
    assert.equal(await fixture.client.exists(`${P}note:n1`), 0);

    // Create under a creator: same two EVALs, index updated in the commit.
    reset();
    const created = await post({ key: "n1", content: "# Q4 plan\nbody", creator_id: ALICE, creator_name: " Alice's notes ", tags: ["Plans", "q4"] });
    assert.equal(created.status, 200);
    assert.deepEqual(commands(), ["EVAL", "EVAL"]);
    assert.equal(created.body.creator_id, undefined);
    assert.equal(created.body.has_creator, true);
    assert.deepEqual(created.body.tags, ["plans", "q4"]);
    assert.deepEqual(await members(A), ["n1"]);
    assert.deepEqual(await counts(A), { plans: "1", q4: "1" });
    assert.equal(await fixture.client.hGet(`${zset(A)}:meta`, "name"), "Alice's notes");
    assert.equal(await fixture.client.hGet(`${P}note:n1`, "title"), "Q4 plan");
    assert.equal(await fixture.client.hGet(`${P}note:n1`, "cid"), A);

    await post({ key: "n2", content: "Second note", creator_id: ALICE, tags: ["q4"] });
    await post({ key: "n3", content: "Third note", creator_id: ALICE, tags: ["plans", "q4", "urgent"] });
    assert.deepEqual(await counts(A), { plans: "2", q4: "3", urgent: "1" });

    // Server-generated id is returned exactly once and works as a credential.
    const generated = await post({ key: "gen", content: "Generated", creator_id: true, creator_name: "Gen" });
    assert.equal(generated.status, 200);
    const genId = generated.body.creator_id as string;
    assert.ok(genId && genId.length >= 22);
    assert.equal((await post({ key: "gen", content: "Again", mode: "append" })).body.creator_id, undefined);
    assert.equal((await list("", { authorization: `Bearer ${genId}` })).body.creator_name, "Gen");

    // GET exposes tags, name and whether the caller's id matches — never the id or its hash.
    const n1 = await read("n1", { authorization: `Bearer ${ALICE}` });
    assert.equal(n1.has_creator, true);
    assert.equal(n1.creator_name, "Alice's notes");
    assert.equal(n1.creator_linked, true);
    assert.deepEqual(n1.tags, ["plans", "q4"]);
    assert.ok(!JSON.stringify(n1).includes(A));
    assert.equal((await read("n1")).creator_linked, false);

    // A content write to a creator note: still two EVALs; bumps score and title, keeps tags.
    const scoreBefore = await fixture.client.zScore(zset(A), "n1");
    await new Promise(resolve => setTimeout(resolve, 5));
    reset();
    assert.equal((await post({ key: "n1", content: "# Renamed plan" })).status, 200);
    assert.deepEqual(commands(), ["EVAL", "EVAL"]);
    assert.ok((await fixture.client.zScore(zset(A), "n1"))! > scoreBefore!);
    assert.equal(await fixture.client.hGet(`${P}note:n1`, "title"), "Renamed plan");
    assert.deepEqual(await counts(A), { plans: "2", q4: "3", urgent: "1" });

    // Retag via PATCH /api/meta: one EVAL, rev and updated_at untouched.
    const revBefore = await fixture.client.hGet(`${P}note:n3`, "rev");
    const updatedBefore = await fixture.client.hGet(`${P}note:n3`, "updated_at");
    reset();
    const retag = await meta({ key: "n3", tags: ["urgent", "Done"] }, { authorization: `Bearer ${ALICE}` });
    assert.equal(retag.status, 200);
    assert.deepEqual(commands(), ["EVAL"]);
    assert.deepEqual(retag.body.tags, ["done", "urgent"]);
    assert.equal(await fixture.client.hGet(`${P}note:n3`, "rev"), revBefore);
    assert.equal(await fixture.client.hGet(`${P}note:n3`, "updated_at"), updatedBefore);
    assert.ok(await fixture.client.hGet(`${P}note:n3`, "meta_updated_at"));
    assert.deepEqual(await counts(A), { plans: "1", q4: "2", urgent: "1", done: "1" });
    assert.deepEqual(await tagged(A, "plans"), ["n1"]);
    // Tag edits need the creator id; the note key alone is not enough.
    assert.equal((await meta({ key: "n3", tags: [] })).status, 403);
    assert.equal((await meta({ key: "n3", tags: [] }, { authorization: `Bearer ${BOB}` })).status, 403);
    assert.equal((await meta({ key: "n3" })).status, 400);
    assert.equal((await meta({ key: "missing-note", creator_id: ALICE })).status, 404);

    // Moving needs the current creator's id.
    assert.equal((await post({ key: "n2", content: "Moved", creator_id: BOB })).status, 403);
    assert.equal(await fixture.client.hGet(`${P}note:n2`, "content"), "Second note");
    assert.equal((await meta({ key: "n2", creator_id: BOB })).status, 403);
    const moved = await meta({ key: "n2", creator_id: BOB, previous_creator_id: ALICE, creator_name: "Bob" });
    assert.equal(moved.status, 200);
    assert.equal(moved.body.creator_name, "Bob");
    assert.deepEqual(moved.body.tags, ["q4"]);
    assert.deepEqual((await members(A)).sort(), ["n1", "n3"]);
    assert.deepEqual(await members(B), ["n2"]);
    assert.deepEqual(await counts(A), { plans: "1", q4: "1", urgent: "1", done: "1" });
    assert.deepEqual(await counts(B), { q4: "1" });

    // Clearing needs proof too, and clears tags.
    assert.equal((await meta({ key: "n2", creator_id: null })).status, 403);
    const cleared = await meta({ key: "n2", creator_id: null }, { authorization: `Bearer ${BOB}` });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.has_creator, false);
    assert.deepEqual(cleared.body.tags, []);
    assert.deepEqual(await members(B), []);
    assert.deepEqual(await counts(B), {});
    assert.equal(await fixture.client.hGet(`${P}note:n2`, "tags"), null);

    // Rename keeps index membership, score and tag sets in step.
    const n3Score = await fixture.client.zScore(zset(A), "n3");
    reset();
    await contentApi.PATCH(send("PATCH", "/api/content", { key: "n3", new_key: "n3-renamed" }));
    assert.deepEqual(commands(), ["EVAL"]);
    assert.deepEqual((await members(A)).sort(), ["n1", "n3-renamed"]);
    assert.equal(await fixture.client.zScore(zset(A), "n3-renamed"), n3Score);
    assert.deepEqual(await tagged(A, "urgent"), ["n3-renamed"]);
    assert.deepEqual(await counts(A), { plans: "1", q4: "1", urgent: "1", done: "1" });

    // Delete removes index entries in the same single command.
    reset();
    await contentApi.DELETE(send("DELETE", "/api/content", { key: "n3-renamed" }));
    assert.deepEqual(commands(), ["EVAL"]);
    assert.deepEqual(await members(A), ["n1"]);
    assert.deepEqual(await counts(A), { plans: "1", q4: "1" });
    assert.equal(await fixture.client.exists(`${zset(A)}:t:urgent`), 0);

    // List: one EVAL, AND filter, refs instead of keys, sort and pagination.
    await post({ key: "n4", content: "# Alpha\nbody", creator_id: ALICE, tags: ["q4"] });
    await post({ key: "n5", content: "# Beta\nbody", creator_id: ALICE, tags: ["plans", "q4"] });
    reset();
    const all = await list();
    assert.deepEqual(commands(), ["EVAL"]);
    assert.equal(all.status, 200);
    assert.equal(all.body.creator_name, "Alice's notes");
    assert.deepEqual(all.body.notes.map((n: { title: string }) => n.title), ["Beta", "Alpha", "Renamed plan"]);
    assert.deepEqual(all.body.tags, [{ tag: "q4", count: 3 }, { tag: "plans", count: 2 }]);
    assert.equal(all.body.notes[0].ref, noteRef(A, "n5"));
    assert.ok(!JSON.stringify(all.body).includes("\"n5\""));
    const both = await list("?tag=plans&tag=Q4");
    assert.deepEqual(both.body.notes.map((n: { title: string }) => n.title), ["Beta", "Renamed plan"]);
    assert.equal(both.body.total, 2);
    const byTitle = await list("?sort=title");
    assert.deepEqual(byTitle.body.notes.map((n: { title: string }) => n.title), ["Alpha", "Beta", "Renamed plan"]);
    const byCreated = await list("?sort=created");
    assert.deepEqual(byCreated.body.notes.map((n: { title: string }) => n.title), ["Beta", "Alpha", "Renamed plan"]);
    assert.equal((await list("?tag=Not%20valid")).status, 400);
    assert.equal((await list("?sort=random")).status, 400);
    assert.equal((await list("", {})).status, 404);
    assert.equal((await list("", { authorization: "Bearer not-a-real-creator-id-000" })).status, 404);

    for (let i = 0; i < 52; i++) await fixture.client.zAdd(zset(A), { score: 1 + i, value: `ghost-${i}` });
    const page1 = await list();
    assert.equal(page1.body.notes.length, 3);
    assert.equal(page1.body.next_cursor, 3);
    const page2 = await list(`?cursor=${page1.body.next_cursor}`);
    assert.deepEqual(page2.body.notes, []);
    assert.equal(page2.body.next_cursor, null);
    assert.equal(await fixture.client.zCard(zset(A)), 3);

    // Expiry is pruned lazily on the next list read, including tag counts.
    await post({ key: "short", content: "Temporary", creator_id: ALICE, tags: ["temp", "q4"], ttl: 1 });
    assert.deepEqual(await counts(A), { plans: "2", q4: "4", temp: "1" });
    await new Promise(resolve => setTimeout(resolve, 1100));
    const afterExpiry = await list();
    assert.equal(afterExpiry.body.total, 3);
    assert.deepEqual(await counts(A), { plans: "2", q4: "3" });
    assert.deepEqual(await tagged(A, "q4"), ["n1", "n4", "n5"]);

    // A recreated key that no longer belongs to the creator is pruned too.
    await fixture.client.zAdd(zset(A), { score: Date.now() + 10, value: "plain-other" });
    await fixture.client.sAdd(`${zset(A)}:t:q4`, "plain-other");
    await fixture.client.hIncrBy(`${zset(A)}:tags`, "q4", 1);
    await post({ key: "plain-other", content: "Not Alice's" });
    assert.equal((await list("?tag=q4")).body.total, 3);
    assert.deepEqual(await counts(A), { plans: "2", q4: "3" });

    // Cap: past 2,000 the least recently updated entry leaves the index; the note stays.
    const { MAX_CREATOR_NOTES } = await import("../app/lib/notes");
    await fixture.client.zAdd(zset(A), { score: 0, value: "n4" });
    const fill = Array.from({ length: MAX_CREATOR_NOTES - 3 }, (_, i) => ({ score: 10 + i, value: `filler-${i}` }));
    await fixture.client.zAdd(zset(A), fill);
    assert.equal(await fixture.client.zCard(zset(A)), MAX_CREATOR_NOTES);
    await post({ key: "newest", content: "Newest", creator_id: ALICE });
    assert.equal(await fixture.client.zCard(zset(A)), MAX_CREATOR_NOTES);
    assert.equal(await fixture.client.zScore(zset(A), "n4"), null);
    assert.equal(await fixture.client.hGet(`${P}note:n4`, "content"), "# Alpha\nbody");
    assert.equal(await fixture.client.hGet(`${P}note:n4`, "cid"), null);
    assert.deepEqual(await counts(A), { plans: "2", q4: "2" });
    await fixture.client.zRem(zset(A), fill.map(f => f.value));

    // Opening a row: ref resolves server-side to a one-off note session.
    const ref = noteRef(A, "n5");
    const open = await openRoute.GET(
      new NextRequest(`http://localhost/c/open/${ref}`, { headers: { cookie: `marker_creator=${ALICE}` } }),
      { params: Promise.resolve({ ref }) },
    );
    assert.equal(open.status, 303);
    assert.equal(new URL(open.headers.get("location")!).pathname, "/");
    assert.equal(open.cookies.get("marker_key")?.value, "n5");
    const wrongCreator = await openRoute.GET(
      new NextRequest(`http://localhost/c/open/${ref}`, { headers: { cookie: `marker_creator=${genId}` } }),
      { params: Promise.resolve({ ref }) },
    );
    assert.equal(new URL(wrongCreator.headers.get("location")!).pathname, "/c");
    assert.equal(wrongCreator.cookies.get("marker_key"), undefined);

    // Browser tag edit: note key from the session cookie, proof from the folder cookie.
    const browserTags = await meta({ tags: ["plans"] }, { cookie: `marker_key=n5; marker_creator=${ALICE}` });
    assert.equal(browserTags.status, 200);
    assert.deepEqual(browserTags.body.tags, ["plans"]);

    // /c?token= moves the id into an httpOnly cookie and strips it from the URL.
    const redirected = proxy(new NextRequest(`http://localhost/c?token=${ALICE}&tag=q4`));
    const location = new URL(redirected.headers.get("location")!);
    assert.equal(location.pathname, "/c");
    assert.equal(location.searchParams.get("token"), null);
    assert.equal(location.searchParams.get("tag"), "q4");
    assert.equal(redirected.cookies.get("marker_creator")?.value, ALICE);
    assert.equal(redirected.cookies.get("marker_creator")?.httpOnly, true);
    assert.equal(redirected.headers.get("Cache-Control"), "no-store, private");
    assert.equal(proxy(new NextRequest("http://localhost/c?token=short")).cookies.get("marker_creator"), undefined);

    // Session: a pasted id is checked first, so a typo never becomes a cookie.
    const goodSession = await sessionApi.POST(send("POST", "/api/creator/session", { creator_id: ALICE }));
    assert.equal(goodSession.status, 200);
    assert.equal(goodSession.cookies.get("marker_creator")?.value, ALICE);
    const badSession = await sessionApi.POST(send("POST", "/api/creator/session", { creator_id: "unknown-creator-id-zzzzzz" }));
    assert.equal(badSession.status, 404);
    assert.equal(badSession.cookies.get("marker_creator"), undefined);

    // Raw ids never reach Redis keys or values.
    for (const key of await fixture.client.keys("*")) {
      assert.ok(!key.includes(ALICE) && !key.includes(BOB) && !key.includes(genId), key);
      const type = await fixture.client.type(key);
      const dump = type === "hash" ? JSON.stringify(await fixture.client.hGetAll(key))
        : type === "zset" ? JSON.stringify(await fixture.client.zRange(key, 0, -1))
        : type === "set" ? JSON.stringify(await fixture.client.sMembers(key))
        : type === "string" ? String(await fixture.client.get(key)) : "";
      assert.ok(!dump.includes(ALICE) && !dump.includes(BOB) && !dump.includes(genId), key);
    }

    // Wrong-id lookups are rate limited per client inside the gate eval.
    const attacker = { "x-forwarded-for": "198.51.100.9" };
    let limited = 0;
    for (let i = 0; i < 31; i++) {
      const guess = await list("", { ...attacker, authorization: `Bearer guess-${String(i).padStart(20, "0")}` });
      if (guess.status === 429) limited++;
    }
    assert.equal(limited, 1);
    assert.equal((await list("", { ...attacker, authorization: `Bearer ${ALICE}` })).status, 429);
    assert.equal((await list()).status, 200);
  } finally {
    await fixture.close();
  }
});
