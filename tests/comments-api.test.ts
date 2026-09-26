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
    assert.equal((await notes.readNote("fixture", true))?.content, "goodbye world");
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
  } finally {
    await fixture.close();
  }
});
