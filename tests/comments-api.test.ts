import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { startRedisRest } from "./helpers/redis-rest";

test("real Lua: API races, combined edit/resolve, lifecycle, isolation and validation", async () => {
  const fixture = await startRedisRest();
  process.env.KV_REST_API_URL = fixture.url;
  process.env.KV_REST_API_TOKEN = "synthetic";
  process.env.VERCEL_ENV = "preview";
  try {
    const notes = await import("../app/lib/notes");
    const api = await import("../app/api/comments/route");
    const { SESSION_COOKIE } = await import("../app/lib/key");
    const post = (body: unknown, cookie = false) =>
      api.POST(
        new NextRequest("http://localhost/api/comments", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(cookie ? { cookie: `${SESSION_COOKIE}=fixture` } : {}),
          },
          body: JSON.stringify(body),
        }),
      );
    const get = (status = "all") =>
      api.GET(
        new NextRequest(
          `http://localhost/api/comments?key=fixture&status=${status}`,
        ),
      );
    await fixture.client.hSet("note:fixture", {
      content: "PRODUCTION SENTINEL",
      rev: "99",
    });
    assert.equal(await notes.readNote("fixture", true), null);
    await notes.writeNote("fixture", "hello world", { ifRev: 0, ttl: 90 });
    const operation = { action: "create", start: 0, end: 5, text: "Clarify" };
    const races = await Promise.all([
      post({ if_rev: 1, operations: [operation] }, true),
      post({ key: "fixture", if_rev: 1, operations: [operation] }),
    ]);
    assert.deepEqual(races.map((r) => r.status).sort(), [200, 409]);
    const snapshot = await (await get()).json();
    assert.equal(snapshot.rev, 2);
    assert.equal(snapshot.comments.length, 1);
    const id = snapshot.comments[0].id;
    const combined = await post({
      key: "fixture",
      if_rev: 2,
      content: "goodbye world",
      operations: [
        { action: "reply", id, text: "Done" },
        { action: "resolve", id },
      ],
    });
    assert.equal(combined.status, 200);
    const result = await combined.json();
    assert.equal(result.rev, 3);
    assert.equal(result.comments[0].resolved, true);
    assert.equal(result.comments[0].location.state, "outdated");
    assert.equal(result.comments[0].messages.at(-1).author, "Agent");
    assert.equal((await (await get("open")).json()).comments.length, 0);
    assert.equal(
      (
        await post(
          {
            if_rev: 3,
            operations: [
              { action: "reopen", id },
              { action: "reply", id, text: "Thanks" },
            ],
          },
          true,
        )
      ).status,
      200,
    );
    assert.equal(
      (await (await get()).json()).comments[0].messages.at(-1).author,
      "You",
    );
    assert.equal(
      (
        await post({
          key: "fixture",
          if_rev: 3,
          content: "LOST UPDATE",
          operations: [{ action: "resolve", id }],
        })
      ).status,
      409,
    );
    assert.equal(
      (await notes.readNote("fixture", true))?.content,
      "goodbye world",
    );
    // A content-only writer and a comment writer share one revision and cannot overwrite each other.
    const mixed = await Promise.all([
      notes.writeNote("fixture", "new text", { ifRev: 4 }),
      post({
        key: "fixture",
        if_rev: 4,
        operations: [{ action: "reply", id, text: "Concurrent" }],
      }),
    ]);
    assert.equal(Number(mixed[0].ok) + Number(mixed[1].status === 200), 1);
    assert.equal((await notes.readNote("fixture", true))?.rev, 5);
    assert.equal((await post(null)).status, 400);
    assert.equal(
      (await post({ key: "fixture", operations: [operation] })).status,
      400,
    );
    assert.equal(
      (
        await post({
          key: "fixture",
          if_rev: 5,
          operations: [{ action: "delete", id }],
        })
      ).status,
      400,
    );
    assert.equal((await notes.readNote("fixture", true))?.rev, 5);
    await notes.renameNote("fixture", "renamed");
    assert.equal(await notes.readNote("fixture", true), null);
    assert.equal((await notes.readNote("renamed", true))?.comments.length, 1);
    assert.ok(
      (await fixture.client.pTTL("marker-commenting-preview-v1:note:renamed")) >
        0,
    );
    await notes.writeNote("renamed", "append", { mode: "append", ttl: 0 });
    assert.equal(
      await fixture.client.pTTL("marker-commenting-preview-v1:note:renamed"),
      -1,
    );
    assert.equal((await notes.readNote("renamed", true))?.comments.length, 1);
    await notes.deleteNote("renamed");
    assert.equal(await notes.readNote("renamed", true), null);
    await notes.writeNote("expires", "temporary", { ttl: 1 });
    await new Promise((resolve) => setTimeout(resolve, 1100));
    assert.equal(await notes.readNote("expires"), null);
    assert.equal(
      await fixture.client.hGet("note:fixture", "content"),
      "PRODUCTION SENTINEL",
    );
    // Legacy migration remains isolated too.
    await fixture.client.set(
      "marker-commenting-preview-v1:content:fixture",
      "hello legacy",
    );
    assert.equal(
      (await post({ key: "fixture", if_rev: 0, operations: [operation] }))
        .status,
      200,
    );
    assert.equal((await notes.readNote("fixture", true))?.comments.length, 1);
    const contentApi = await import("../app/api/content/route");
    const { locateThreads } = await import("../app/lib/comments");
    const repeated =
      "first: same phrase\nsecond: same phrase\nthird: same phrase\nfourth: same phrase";
    const contentPost = (body: unknown) =>
      contentApi.POST(
        new NextRequest("http://localhost/api/content", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
    await notes.deleteNote("fixture");
    assert.equal(
      (await contentPost({ key: "fixture", content: repeated, ttl: 120 }))
        .status,
      200,
    );
    const start = repeated.indexOf("same phrase", repeated.indexOf("third:"));
    assert.equal(
      (
        await post({
          key: "fixture",
          if_rev: 1,
          operations: [
            {
              action: "create",
              start,
              end: start + 11,
              text: "Third occurrence",
            },
          ],
        })
      ).status,
      200,
    );
    const thirdId = (await (await get()).json()).comments[0].id;
    const updated =
      "Before\n" + repeated.replace("second:", "longer second:") + "\nAfter";
    // Old clients supply content only, with no if_rev and no knowledge of threads.
    assert.equal(
      (await contentPost({ key: "fixture", content: updated })).status,
      200,
    );
    let state = await (await get()).json();
    assert.equal(
      state.comments[0].location.start,
      updated.indexOf("same phrase", updated.indexOf("third:")),
    );
    const pttlBefore = await fixture.client.pTTL(
      "marker-commenting-preview-v1:note:fixture",
    );
    const oldOffset = state.comments[0].location.start;
    const concurrent = await Promise.all([
      contentPost({ key: "fixture", content: "Prefix", mode: "prepend" }),
      contentPost({ key: "fixture", content: "Suffix", mode: "append" }),
    ]);
    assert.deepEqual(
      concurrent.map((r) => r.status),
      [200, 200],
    );
    state = await (await get()).json();
    assert.equal(state.content, "Prefix\n" + updated + "\nSuffix");
    assert.equal(state.comments[0].location.start, oldOffset + 7);
    assert.equal(state.rev, 5);
    const pttlAfter = await fixture.client.pTTL(
      "marker-commenting-preview-v1:note:fixture",
    );
    assert.ok(pttlAfter > 0 && pttlAfter <= pttlBefore);
    // Revision-checked writers cannot commit maps computed against a stale source.
    const safeRev = state.rev;
    const checked = await Promise.all([
      contentPost({
        key: "fixture",
        content: "checked\n" + state.content,
        if_rev: safeRev,
      }),
      post({
        key: "fixture",
        if_rev: safeRev,
        content: state.content + "\nreviewed",
        operations: [{ action: "reply", id: thirdId, text: "Review" }],
      }),
    ]);
    assert.deepEqual(checked.map((r) => r.status).sort(), [200, 409]);
    state = await (await get()).json();
    assert.equal(
      state.comments[0].location.start,
      state.content.indexOf("same phrase", state.content.indexOf("third:")),
    );
    const rewritten = state.content.replace(
      "third: same phrase",
      "third: new text",
    );
    const edited = await post({
      key: "fixture",
      if_rev: state.rev,
      content: rewritten,
      operations: [
        { action: "reply", id: thirdId, text: "Edited" },
        { action: "resolve", id: thirdId },
      ],
    });
    assert.equal(edited.status, 200);
    const editedBody = await edited.json();
    assert.equal(editedBody.comments[0].location.state, "outdated");
    assert.equal(editedBody.comments[0].anchor.position, null);
    await notes.renameNote("fixture", "mapped-renamed");
    const renamed = await notes.readNote("mapped-renamed", true);
    assert.equal(renamed?.comments[0].anchor.position, null);
    assert.equal(
      locateThreads(renamed!.content, renamed!.comments)[0].location.state,
      "outdated",
    );
    assert.ok(
      (await fixture.client.pTTL(
        "marker-commenting-preview-v1:note:mapped-renamed",
      )) > 0,
    );
    await notes.writeNote("mapped-renamed", rewritten, { ttl: 1 });
    await new Promise((resolve) => setTimeout(resolve, 1100));
    assert.equal(await notes.readNote("mapped-renamed", true), null);
  } finally {
    await fixture.close();
  }
});
