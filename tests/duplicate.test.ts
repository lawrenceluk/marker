import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { startRedisRest } from "./helpers/redis-rest";
import { R2_TEST_ENV, startR2Mock } from "./helpers/r2-mock";
import { duplicateNoteContent, rewriteAssetReferences } from "../app/lib/duplicate-content";

test("duplicate title prefixing: front matter, heading, or unchanged", () => {
  const fm = `---
title: Launch plan
status: draft
---
# Body title

Paragraph.`;
  assert.ok(duplicateNoteContent(fm).includes("[COPY] Launch plan"));

  const heading = "# Only heading\n\nText.";
  assert.equal(duplicateNoteContent(heading), "# [COPY] Only heading\n\nText.");

  const plain = "No title here.\n\nJust text.";
  assert.equal(duplicateNoteContent(plain), plain);
});

test("rewriteAssetReferences maps ids in images and embed posters", () => {
  const idA = "AAAAAAAAAAAAAAAAAAAAAA";
  const idB = "BBBBBBBBBBBBBBBBBBBBBB";
  const idC = "CCCCCCCCCCCCCCCCCCCCCC";
  const content = `![x](marker-asset:${idA})\n![cap](marker-embed:${idB} "h=200 poster=marker-asset:${idC}")`;
  const map = { [idA]: "DDDDDDDDDDDDDDDDDDDDDD", [idB]: "EEEEEEEEEEEEEEEEEEEEEE", [idC]: "FFFFFFFFFFFFFFFFFFFFFF" };
  const out = rewriteAssetReferences(content, map);
  assert.match(out, /marker-asset:DDDDDDDDDDDDDDDDDDDDDD/);
  assert.match(out, /marker-embed:EEEEEEEEEEEEEEEEEEEEEE/);
  assert.match(out, /poster=marker-asset:FFFFFFFFFFFFFFFFFFFFFF/);
});

test("duplicate rolls back copied objects when redis install fails", async () => {
  const fixture = await startRedisRest();
  const r2 = await startR2Mock();
  process.env.KV_REST_API_URL = fixture.url;
  process.env.KV_REST_API_TOKEN = "synthetic";
  process.env.VERCEL_ENV = "preview";
  Object.assign(process.env, R2_TEST_ENV, { R2_ENDPOINT: r2.url });

  const notes = await import("../app/lib/notes");
  const { duplicateNote } = await import("../app/lib/duplicate");
  const contentRoute = await import("../app/api/content/route");
  const assetsRoute = await import("../app/api/assets/route");
  const { r2Config } = await import("../app/lib/r2");
  const req = (path: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }) =>
    new NextRequest(`https://marker.test${path}`, {
      method: init?.method ?? "GET",
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      headers: { "content-type": "application/json", ...init?.headers },
    });

  const key = "dup-source";
  await contentRoute.POST(req("/api/content", { method: "POST", body: { key, content: "# Trip", if_rev: 0 } }));
  const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
  const reserved = await assetsRoute.POST(
    req("/api/assets", { method: "POST", body: { key, content_type: "image/png", data_base64: PNG.toString("base64") } }),
  );
  const { asset_id, markdown } = await reserved.json();
  await contentRoute.POST(req("/api/content", { method: "POST", body: { key, content: `# Trip\n${markdown}` } }));

  const source = await notes.readNote(key, true);
  assert.ok(source?.assetNs);

  const config = r2Config()!;
  const beforeObjects = r2.objects.size;

  const dest = "dup-dest-taken";
  await notes.writeNote(dest, "blocker", { ifRev: 0 });

  const result = await duplicateNote(key, dest, config, source!);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "exists");
  assert.equal(r2.objects.size, beforeObjects, "no orphan objects after failed install");

  const still = await notes.readNote(key, true);
  assert.ok(still?.assets[asset_id]);
  await fixture.close();
  await r2.close();
});
