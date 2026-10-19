import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { startRedisRest } from "./helpers/redis-rest";
import { R2_TEST_ENV, startR2Mock } from "./helpers/r2-mock";
import { browserNoteSession } from "./helpers/noteSession";
import { persistCookieName, sessionKeyCookieName } from "../app/lib/noteSession";
import { NOTE_BINDING_HEADER, NOTE_SWITCHED_CODE } from "../app/lib/noteClient";
import { duplicateNoteContent, rewriteAssetReferences } from "../app/lib/duplicate-content";
import { duplicateRoute } from "./helpers/duplicate-route";
import { storagePrefix } from "../app/lib/namespace";

async function countNoteHashes(redis: { keys: (pattern: string) => Promise<string[]> }) {
  return (await redis.keys(`${storagePrefix()}note:*`)).length;
}

test("duplicate title prefixing: front matter line, heading outside fences, or unchanged", () => {
  const fm = `---
title: Launch plan
status: draft
---
# Body title

Paragraph.`;
  const out = duplicateNoteContent(fm);
  assert.ok(out.includes("[COPY] Launch plan"));
  assert.ok(out.includes("status: draft"));
  assert.ok(!out.match(/^title: Launch plan$/m));

  const heading = "# Only heading\n\nText.";
  assert.equal(duplicateNoteContent(heading), "# [COPY] Only heading\n\nText.");

  const fenced = "```\n# Not a title\n```\n\n# Real title\n";
  assert.equal(
    duplicateNoteContent(fenced),
    "```\n# Not a title\n```\n\n# [COPY] Real title\n",
  );

  const indentedFence = "    ```\n    # Not a title\n    ```\n\n# Real title\n";
  assert.equal(
    duplicateNoteContent(indentedFence),
    "    ```\n    # Not a title\n    ```\n\n# [COPY] Real title\n",
  );

  const blockTitle = `---
title: |
  Multi line
  title
status: ok
---
Body`;
  const blockOut = duplicateNoteContent(blockTitle);
  assert.ok(blockOut.includes("  [COPY] Multi line"));

  const plain = "No title here.\n\nJust text.";
  assert.equal(duplicateNoteContent(plain), plain);
});

test("rewriteAssetReferences maps ids and leaves unknown ids unchanged", () => {
  const idA = "AAAAAAAAAAAAAAAAAAAAAA";
  const idB = "BBBBBBBBBBBBBBBBBBBBBB";
  const idC = "CCCCCCCCCCCCCCCCCCCCCC";
  const missing = "ZZZZZZZZZZZZZZZZZZZZZZ";
  const content = `![x](marker-asset:${idA})\n![cap](marker-embed:${idB} "poster=marker-asset:${idC}")\n![orphan](marker-asset:${missing})`;
  const map = { [idA]: "DDDDDDDDDDDDDDDDDDDDDD", [idB]: "EEEEEEEEEEEEEEEEEEEEEE", [idC]: "FFFFFFFFFFFFFFFFFFFFFF" };
  const out = rewriteAssetReferences(content, map);
  assert.match(out, /marker-asset:DDDDDDDDDDDDDDDDDDDDDD/);
  assert.match(out, /marker-embed:EEEEEEEEEEEEEEEEEEEEEE/);
  assert.ok(out.includes(`marker-asset:${missing}`));
});

test("duplicate API and storage: rollback, binding, folder, storage cap, rate limit", async () => {
  const fixture = await startRedisRest();
  const r2 = await startR2Mock();
  process.env.KV_REST_API_URL = fixture.url;
  process.env.KV_REST_API_TOKEN = "synthetic";
  process.env.VERCEL_ENV = "preview";
  Object.assign(process.env, R2_TEST_ENV, { R2_ENDPOINT: r2.url });

  const notes = await import("../app/lib/notes");
  const contentRoute = await import("../app/api/content/route");
  const assetsRoute = await import("../app/api/assets/route");
  const { r2Config } = await import("../app/lib/r2");
  const {
    duplicateNote,
    reserveDuplicateAttempt,
    duplicateRateStatus,
    DUPLICATES_PER_HOUR,
  } = await import("../app/lib/duplicate");
  const { STORAGE_STOP_BYTES } = await import("../app/lib/assetIndex");
  const { redis } = await import("../app/lib/redis");
  const { POST: duplicatePost } = await duplicateRoute();

  const req = (path: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }) =>
    new NextRequest(`https://marker.test${path}`, {
      method: init?.method ?? "GET",
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      headers: { "content-type": "application/json", ...init?.headers },
    });
  const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

  const key = "dup-source";
  await contentRoute.POST(req("/api/content", { method: "POST", body: { key, content: "# Trip", if_rev: 0 } }));
  const reserved = await assetsRoute.POST(
    req("/api/assets", { method: "POST", body: { key, content_type: "image/png", data_base64: PNG.toString("base64") } }),
  );
  const { markdown } = await reserved.json();
  await contentRoute.POST(req("/api/content", { method: "POST", body: { key, content: `# Trip\n${markdown}` } }));

  const source = await notes.readNote(key, true);
  assert.ok(source?.assetNs);

  const config = r2Config()!;
  const beforeObjects = r2.objects.size;
  const dest = "dup-dest-taken";
  await notes.writeNote(dest, "blocker", { ifRev: 0 });
  const rollback = await duplicateNote(key, dest, config, source!, { copyCreator: false });
  assert.equal(rollback.ok, false);
  assert.equal(rollback.reason, "exists");
  assert.equal(r2.objects.size, beforeObjects, "no orphan objects after failed install");

  const bindingKey = "dup-binding-source";
  await contentRoute.POST(req("/api/content", { method: "POST", body: { key: bindingKey, content: "# One", if_rev: 0 } }));
  const session = browserNoteSession(bindingKey);
  await contentRoute.POST(req("/api/content", { method: "POST", body: { key: "other-key-that-exists", content: "# Two", if_rev: 0 } }));
  const before = await notes.readNote(bindingKey, true);
  const noteCountBeforeBinding = await countNoteHashes(redis);
  const bindingRes = await duplicatePost(
    req("/api/content/duplicate", {
      method: "POST",
      headers: {
        cookie: `${sessionKeyCookieName(session.handle)}=other-key-that-exists`,
        [NOTE_BINDING_HEADER]: session.binding,
      },
    }),
  );
  const bindingBody = await bindingRes.json();
  assert.equal(bindingRes.status, 409);
  assert.equal(bindingBody.code, NOTE_SWITCHED_CODE);
  assert.equal((await notes.readNote(bindingKey, true))?.rev, before?.rev);
  assert.equal(await countNoteHashes(redis), noteCountBeforeBinding);

  const created = await contentRoute.POST(
    req("/api/content", {
      method: "POST",
      body: { key: "folder-src", content: "# Folder", if_rev: 0, creator_id: true, creator_name: "Team", tags: ["plans"] },
    }),
  );
  const { creator_id } = await created.json();
  const folderSource = await notes.readNote("folder-src", true);
  assert.ok(folderSource?.cid);
  const anon = await duplicateNote("folder-src", "folder-copy-anon", r2Config(), folderSource!, { copyCreator: false });
  assert.ok(anon.ok);
  const copyAnon = await notes.readNote("folder-copy-anon", true);
  assert.equal(copyAnon?.cid, null);
  assert.deepEqual(copyAnon?.tags, []);

  const proofSession = browserNoteSession("folder-src");
  const proofRes = await duplicatePost(
    req("/api/content/duplicate", {
      method: "POST",
      headers: {
        cookie: `${proofSession.headers.cookie}; ${persistCookieName(proofSession.handle)}=1`,
        [NOTE_BINDING_HEADER]: proofSession.binding,
        authorization: `Bearer ${creator_id}`,
      },
    }),
  );
  assert.equal(proofRes.status, 200);
  const proofBody = await proofRes.json();
  assert.ok(proofBody.success);
  const proofKey = typeof proofBody.key === "string" ? proofBody.key : "";
  assert.ok(proofKey);
  const copyProof = await notes.readNote(proofKey, true);
  assert.equal(copyProof?.cid, folderSource?.cid);
  assert.deepEqual(copyProof?.tags, folderSource?.tags);
  assert.equal(copyProof?.seenRev, 1);

  const storageKey = "dup-storage-full";
  await contentRoute.POST(req("/api/content", { method: "POST", body: { key: storageKey, content: "# Full", if_rev: 0 } }));
  const storageReserve = await assetsRoute.POST(
    req("/api/assets", { method: "POST", body: { key: storageKey, content_type: "image/png", data_base64: PNG.toString("base64") } }),
  );
  const { markdown: storageMd } = await storageReserve.json();
  await contentRoute.POST(req("/api/content", { method: "POST", body: { key: storageKey, content: `# Full\n${storageMd}` } }));
  const storageSource = await notes.readNote(storageKey, true);
  assert.ok(storageSource?.assetNs);
  assert.ok(Object.keys(storageSource!.assets).length > 0);
  await redis.set(`${storagePrefix()}assets:bytes`, STORAGE_STOP_BYTES);
  const storageBlock = await duplicateNote(storageKey, "dup-dest-full", r2Config(), storageSource!, { copyCreator: false });
  assert.equal(storageBlock.ok, false);
  assert.equal(storageBlock.reason, "storage_full");

  const rateKey = "dup-rate-route";
  await contentRoute.POST(req("/api/content", { method: "POST", body: { key: rateKey, content: "# Rate", if_rev: 0 } }));
  const rateSession = browserNoteSession(rateKey);
  for (let i = 0; i < DUPLICATES_PER_HOUR; i++) {
    assert.equal((await reserveDuplicateAttempt(rateKey, "rate-client")).ok, true);
  }
  const limited = await duplicatePost(
    req("/api/content/duplicate", { method: "POST", headers: rateSession.headers }),
  );
  assert.equal(limited.status, 429);
  assert.ok(limited.headers.get("Retry-After"));

  assert.equal((await duplicateRateStatus("note-b", "client-b")).ok, true);

  const r2Fail = await startR2Mock();
  Object.assign(process.env, R2_TEST_ENV, { R2_ENDPOINT: r2Fail.url });
  const sweepKey = `${storagePrefix()}assets:sweep`;
  await redis.set(`${storagePrefix()}assets:bytes`, 0);

  const rollbackKey = "dup-rollback";
  await contentRoute.POST(req("/api/content", { method: "POST", body: { key: rollbackKey, content: "# Roll", if_rev: 0 } }));
  const a = await assetsRoute.POST(
    req("/api/assets", { method: "POST", body: { key: rollbackKey, content_type: "image/png", data_base64: PNG.toString("base64") } }),
  );
  const b = await assetsRoute.POST(
    req("/api/assets", { method: "POST", body: { key: rollbackKey, content_type: "image/png", data_base64: PNG.toString("base64") } }),
  );
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  const { markdown: mdA } = await a.json();
  const { markdown: mdB } = await b.json();
  await contentRoute.POST(
    req("/api/content", { method: "POST", body: { key: rollbackKey, content: `# Roll\n${mdA}\n${mdB}` } }),
  );
  const rollbackSource = await notes.readNote(rollbackKey, true);
  assert.ok(rollbackSource);
  assert.equal(Object.keys(rollbackSource!.assets).length, 2);
  assert.ok(r2Fail.objects.size >= 2, "source assets must live on the active R2 mock");
  const rollbackBeforeObjects = r2Fail.objects.size;
  const beforeNotes = await countNoteHashes(redis);
  const sweepBeforeRollback = await redis.zrange<string[]>(sweepKey, 0, -1);

  r2Fail.failDuplicatePutAfter(2);
  const rollbackResult = await duplicateNote(rollbackKey, "dup-rollback-dest", r2Config()!, rollbackSource!, { copyCreator: false });
  assert.equal(rollbackResult.ok, false);
  assert.equal(rollbackResult.reason, "copy_failed");
  assert.equal(r2Fail.objects.size, rollbackBeforeObjects);
  assert.equal(await countNoteHashes(redis), beforeNotes);
  assert.ok(!(await redis.exists(`${storagePrefix()}note:dup-rollback-dest`)));

  const sweepAfterRollback = await redis.zrange<string[]>(sweepKey, 0, -1);
  assert.deepEqual(sweepAfterRollback, sweepBeforeRollback, "orphan sweep unchanged after rollback");

  const r2Again = await startR2Mock();
  Object.assign(process.env, R2_TEST_ENV, { R2_ENDPOINT: r2Again.url });

  const missKey = "dup-missing-r2";
  await contentRoute.POST(req("/api/content", { method: "POST", body: { key: missKey, content: "# Miss", if_rev: 0 } }));
  const good = await assetsRoute.POST(
    req("/api/assets", { method: "POST", body: { key: missKey, content_type: "image/png", data_base64: PNG.toString("base64") } }),
  );
  const { asset_id: goodId, markdown: goodMd } = await good.json();
  const ghostId = "ZZZZZZZZZZZZZZZZZZZZZZ";
  await contentRoute.POST(
    req("/api/content", {
      method: "POST",
      body: {
        key: missKey,
        content: `# Miss\n${goodMd}\n![ghost](marker-asset:${ghostId})`,
        mode: "overwrite",
      },
    }),
  );
  const missSource = await notes.readNote(missKey, true);
  assert.ok(missSource);
  missSource!.assets[ghostId] = { t: "png", s: 10, c: Date.now() };

  const missDest = "dup-missing-r2-copy";
  const missResult = await duplicateNote(missKey, missDest, r2Config()!, missSource!, { copyCreator: false });
  assert.ok(missResult.ok);
  const copy = await notes.readNote(missDest, true);
  assert.ok(copy?.content.includes(`marker-asset:${ghostId}`));
  assert.ok(!copy?.content.includes(`marker-asset:${goodId}`));
  assert.equal(Object.keys(copy!.assets).length, 1);

  await fixture.close();
  await r2.close();
  await r2Fail.close();
  await r2Again.close();
});
