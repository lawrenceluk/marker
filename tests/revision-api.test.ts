import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { startRedisRest } from "./helpers/redis-rest";

test("revision endpoint reads one isolated field and never returns document or comments", async () => {
  const fixture = await startRedisRest();
  process.env.KV_REST_API_URL = fixture.url;
  process.env.KV_REST_API_TOKEN = "synthetic";
  process.env.VERCEL_ENV = "preview";
  try {
    const { GET } = await import("../app/api/revision/route");
    await fixture.client.hSet("note:fixture", { rev: "99", content: "Production sentinel" });
    await fixture.client.hSet("marker-commenting-preview-v1:note:fixture", {
      rev: "7", content: "Private document", comments: "Private comment",
    });
    const response = await GET(new NextRequest("http://localhost/api/revision", { headers: { cookie: "marker_key=fixture" } }));
    assert.deepEqual(await response.json(), { rev: 7 });
    assert.equal(response.headers.get("Cache-Control"), "no-store, private");
    assert.match(response.headers.get("X-Robots-Tag")!, /noindex/);
    assert.deepEqual(fixture.commands.map(command => command.map((part, index) => index === 0 ? part.toUpperCase() : part)), [["HGET", "marker-commenting-preview-v1:note:fixture", "rev"]]);
    assert.deepEqual(await (await GET(new NextRequest("http://localhost/api/revision?key=absent"))).json(), { rev: 0 });
    const missing = await GET(new NextRequest("http://localhost/api/revision"));
    assert.equal(missing.status, 400);
    assert.equal(await fixture.client.hGet("note:fixture", "rev"), "99");
  } finally { await fixture.close(); }
});
