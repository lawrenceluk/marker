import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { startRedisRest } from "./helpers/redis-rest";
import { R2_TEST_ENV, startR2Mock } from "./helpers/r2-mock";
import { signature } from "../app/lib/r2";
import { previewFromMarkdown, ogBodyText } from "../app/lib/preview";

const P = "marker-commenting-preview-v1:";
const DAY = 24 * 60 * 60 * 1000;
// 1×1 transparent PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

test("SigV4 matches the AWS S3 test vectors", () => {
  const config = { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", region: "us-east-1" };
  const presigned = new URL("https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host");
  assert.equal(
    signature({ method: "GET", url: presigned, headers: { host: presigned.host }, payloadHash: "UNSIGNED-PAYLOAD", date: "20130524T000000Z", config }).signature,
    "aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
  );
  const empty = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  const plain = new URL("https://examplebucket.s3.amazonaws.com/test.txt");
  assert.equal(
    signature({ method: "GET", url: plain, headers: { host: plain.host, range: "bytes=0-9", "x-amz-content-sha256": empty, "x-amz-date": "20130524T000000Z" }, payloadHash: empty, date: "20130524T000000Z", config }).signature,
    "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
  );
});

test("link previews and cached titles ignore marker images", () => {
  assert.equal(previewFromMarkdown("![IMG_2041.jpg](marker-asset:AAAAAAAAAAAAAAAAAAAAAA)\n# Trip\nDay one")?.title, "Trip");
  assert.ok(!ogBodyText("Look ![shot](marker-asset:AAAAAAAAAAAAAAAAAAAAAA) here").includes("marker-asset"));
});

test("images: reserve, upload, reference tracking, grace sweep, cascade, alerts and Redis cost", async () => {
  const fixture = await startRedisRest();
  const r2 = await startR2Mock();
  process.env.KV_REST_API_URL = fixture.url;
  process.env.KV_REST_API_TOKEN = "synthetic";
  process.env.VERCEL_ENV = "preview";
  process.env.CRON_SECRET = "cron-secret";
  delete process.env.RESEND_API_KEY;
  const configure = () => Object.assign(process.env, R2_TEST_ENV, { R2_ENDPOINT: r2.url });
  const unconfigure = () => { for (const k of [...Object.keys(R2_TEST_ENV), "R2_ENDPOINT"]) delete process.env[k]; };
  const realFetch = globalThis.fetch;
  const emails: { subject: string; to: string[] }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).startsWith("https://api.resend.com/")) {
      emails.push(JSON.parse(String(init?.body)));
      return new Response("{}", { status: 200 });
    }
    return realFetch(input, init);
  }) as typeof fetch;
  const realNow = Date.now;
  try {
    const content = await import("../app/api/content/route");
    const assets = await import("../app/api/assets/route");
    const urls = await import("../app/api/assets/urls/route");
    const cron = await import("../app/api/cron/assets-sweep/route");
    const req = (path: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }) =>
      new NextRequest(`https://marker.test${path}`, {
        method: init?.method ?? "GET",
        body: init?.body === undefined ? undefined : JSON.stringify(init.body),
        headers: { "content-type": "application/json", ...init?.headers },
      });
    const write = (key: string, text: string, extra: Record<string, unknown> = {}) => content.POST(req("/api/content", { method: "POST", body: { key, content: text, ...extra } }));
    const read = async (key: string) => (await content.GET(req(`/api/content?key=${key}`))).json();
    const reserve = (body: Record<string, unknown>) => assets.POST(req("/api/assets", { method: "POST", body }));
    const sweep = (secret = "cron-secret") => cron.GET(req("/api/cron/assets-sweep", { headers: { authorization: `Bearer ${secret}` } }));
    const evals = () => fixture.commands.filter(c => c[0].toUpperCase() === "EVAL").length;
    const sweepScore = (member: string) => fixture.client.zScore(`${P}assets:sweep`, member);
    const hash = (key: string) => fixture.client.hGetAll(`${P}note:${key}`);
    const settle = () => new Promise(r => setTimeout(r, 50));

    // Without R2 env: the images API is unavailable, everything else unchanged.
    unconfigure();
    await write("plain", "# Plain note");
    assert.equal((await reserve({ key: "plain", content_type: "image/png", size: 10 })).status, 503);
    assert.equal((await urls.GET(req("/api/assets/urls?key=plain"))).status, 503);
    assert.deepEqual((await read("plain")).assets, []);
    assert.equal((await sweep()).status, 503);

    // Existing paths cost what they did: write 2 EVALs, read 1, rename 1, delete 1.
    configure();
    fixture.commands.length = 0;
    await write("plain", "# Plain note, again");
    assert.deepEqual(fixture.commands.map(c => c[0].toUpperCase()), ["EVAL", "EVAL"]);
    fixture.commands.length = 0;
    await read("plain");
    assert.deepEqual(fixture.commands.map(c => c[0].toUpperCase()), ["EVAL"]);
    fixture.commands.length = 0;
    await content.PATCH(req("/api/content", { method: "PATCH", body: { key: "plain", new_key: "plain2" } }));
    await content.DELETE(req("/api/content", { method: "DELETE", body: { key: "plain2" } }));
    assert.deepEqual(fixture.commands.map(c => c[0].toUpperCase()), ["EVAL", "EVAL"]);
    const plainKeys = await fixture.client.keys(`${P}assets:*`);
    assert.deepEqual(plainKeys, [], "notes without images touch no asset keys");

    // Validation.
    await write("trip", "# Trip");
    assert.equal((await reserve({ key: "missing", content_type: "image/png", size: 10 })).status, 404);
    assert.equal((await reserve({ key: "trip", content_type: "image/svg+xml", size: 10 })).status, 415);
    assert.equal((await reserve({ key: "trip", content_type: "image/png", size: 5 * 1024 * 1024 + 1 })).status, 413);
    assert.equal((await reserve({ key: "trip", content_type: "image/png", size: 0 })).status, 400);
    assert.equal((await reserve({ key: "trip", content_type: "image/png", data_base64: "A".repeat(1_400_000) })).status, 413);
    assert.equal((await reserve({ key: "trip", content_type: "image/png", data_base64: "not base64!" })).status, 400);

    // Reserve: one EVAL, no rev change; presigned PUT locks type and length.
    fixture.commands.length = 0;
    const res = await reserve({ key: "trip", content_type: "image/png", size: PNG.length, filename: "dot.png" });
    assert.equal(res.status, 200);
    assert.equal(evals(), 1);
    assert.equal(fixture.commands.length, 1);
    const reserved = await res.json();
    assert.match(reserved.asset_id, /^[A-Za-z0-9_-]{22}$/);
    assert.equal(reserved.markdown, `![](marker-asset:${reserved.asset_id})`);
    assert.deepEqual(reserved.upload_headers, { "Content-Type": "image/png", "Content-Length": String(PNG.length) });
    assert.equal(reserved.expires_in, 600);
    assert.equal((await read("trip")).rev, 1);
    const ns = (await hash("trip")).asset_ns;
    assert.equal(ns.length, 16);
    assert.ok(!JSON.stringify(await fixture.client.keys("*")).includes("trip|"), "no key embeds the note key");

    const badType = await realFetch(reserved.upload_url, { method: "PUT", body: PNG, headers: { "Content-Type": "image/gif" } });
    assert.equal(badType.status, 403);
    const badLength = await realFetch(reserved.upload_url, { method: "PUT", body: Buffer.concat([PNG, PNG]), headers: { "Content-Type": "image/png" } });
    assert.equal(badLength.status, 403);
    const put = await realFetch(reserved.upload_url, { method: "PUT", body: PNG, headers: reserved.upload_headers });
    assert.equal(put.status, 200);
    assert.ok(r2.objects.has(`${ns}/${reserved.asset_id}`));

    // GET /api/content lists it with an hour-aligned view URL and a pending deletion (not yet referenced).
    let info = await read("trip");
    assert.equal(info.assets.length, 1);
    const [listed] = info.assets;
    assert.equal(listed.id, reserved.asset_id);
    assert.equal(listed.type, "image/png");
    assert.equal(listed.size, PNG.length);
    assert.ok(listed.delete_after > Date.now() + DAY - 60_000);
    assert.equal(listed.expires_at % (60 * 60 * 1000), 0);
    assert.ok(listed.expires_at >= Date.now() + 60 * 60 * 1000);
    const view = await realFetch(listed.url);
    assert.equal(view.status, 200);
    assert.equal(view.headers.get("content-type"), "image/png");
    assert.equal(view.headers.get("content-disposition"), "inline");
    assert.deepEqual(Buffer.from(await view.arrayBuffer()), PNG);
    assert.equal((await read("trip")).assets[0].url, listed.url, "URLs are stable within the hour");
    const refreshed = await (await urls.GET(req("/api/assets/urls?key=trip"))).json();
    assert.equal(refreshed.urls[reserved.asset_id], listed.url);

    // Referencing it cancels the deletion; the write still costs 2 EVALs.
    fixture.commands.length = 0;
    await write("trip", `${reserved.markdown}\n`, { mode: "append" });
    assert.deepEqual(fixture.commands.map(c => c[0].toUpperCase()), ["EVAL", "EVAL"]);
    info = await read("trip");
    assert.equal(info.assets[0].delete_after, null);
    assert.equal(await sweepScore(`${ns}|trip`), null, "nothing left to sweep");

    // Removing the reference schedules deletion after the grace period; re-adding cancels it.
    const t0 = Date.now();
    await write("trip", "# Trip\nno image");
    info = await read("trip");
    assert.ok(Math.abs(info.assets[0].delete_after - (t0 + DAY)) < 5_000);
    assert.ok(Math.abs((await sweepScore(`${ns}|trip`))! - (t0 + DAY)) < 5_000);
    await write("trip", `# Trip\n![dot.png](marker-asset:${reserved.asset_id})`);
    assert.equal((await read("trip")).assets[0].delete_after, null);
    await write("trip", "# Trip\ngone again");

    // The sweep needs the cron secret; before the grace period it keeps the image.
    assert.equal((await sweep("wrong")).status, 401);
    let summary = await (await sweep()).json();
    assert.equal(summary.removed, 0);
    assert.ok(r2.objects.has(`${ns}/${reserved.asset_id}`));

    // A base64 upload goes through the server in one call.
    const b64 = await (await reserve({ key: "trip", content_type: "image/png", data_base64: PNG.toString("base64") })).json();
    assert.equal(b64.uploaded, true);
    assert.equal(b64.upload_url, undefined);
    assert.equal(r2.objects.get(`${ns}/${b64.asset_id}`)?.contentType, "image/png");
    await write("trip", `# Trip\n${b64.markdown}`);

    // Past the grace period the unreferenced image is deleted; the referenced one stays.
    const bytesBefore = Number(await fixture.client.get(`${P}assets:bytes`));
    Date.now = () => realNow() + DAY + 60_000;
    summary = await (await sweep()).json();
    Date.now = realNow;
    assert.equal(summary.removed, 1);
    assert.ok(!r2.objects.has(`${ns}/${reserved.asset_id}`));
    assert.ok(r2.objects.has(`${ns}/${b64.asset_id}`));
    assert.deepEqual((await read("trip")).assets.map((a: { id: string }) => a.id), [b64.asset_id]);
    assert.equal(Number(await fixture.client.get(`${P}assets:bytes`)), bytesBefore - PNG.length);
    assert.equal(await sweepScore(`${ns}|trip`), null);

    // Rename carries the images (same prefix) and the sweep entry.
    await write("trip", "# Trip\nunreferenced now");
    await content.PATCH(req("/api/content", { method: "PATCH", body: { key: "trip", new_key: "trip-2" } }));
    assert.equal(await sweepScore(`${ns}|trip`), null);
    assert.ok(await sweepScore(`${ns}|trip-2`));
    assert.equal((await read("trip-2")).assets[0].id, b64.asset_id);
    await write("trip-2", `# Trip\n${b64.markdown}`);

    // Delete cascades: objects go right away, accounting drops, and the sweep later confirms the prefix is empty.
    fixture.commands.length = 0;
    await content.DELETE(req("/api/content", { method: "DELETE", body: { key: "trip-2" } }));
    assert.deepEqual(fixture.commands.map(c => c[0].toUpperCase()), ["EVAL"]);
    await settle();
    assert.ok(![...r2.objects.keys()].some(k => k.startsWith(`${ns}/`)));
    assert.equal(await fixture.client.hGet(`${P}assets:nsbytes`, ns), null);
    assert.ok(await sweepScore(`${ns}|trip-2`));
    summary = await (await sweep()).json();
    assert.equal(summary.purged, 1);
    assert.equal(await sweepScore(`${ns}|trip-2`), null);

    // An expiring note is purged by the sweep once its TTL fires.
    await write("short", "# Short", { ttl: 3600 });
    const s1 = await (await reserve({ key: "short", content_type: "image/gif", data_base64: PNG.toString("base64") })).json();
    await write("short", `# Short\n${s1.markdown}`);
    const shortNs = (await hash("short")).asset_ns;
    const due = (await sweepScore(`${shortNs}|short`))!;
    assert.ok(Math.abs(due - (Date.now() + 3600_000)) < 5_000, "scheduled at the note's expiry");
    await write("short", `# Short\n${s1.markdown}`, { ttl: 0 });
    assert.equal(await sweepScore(`${shortNs}|short`), null, "clearing the TTL unschedules it");
    await write("short", `# Short\n${s1.markdown}`, { ttl: 60 });
    await fixture.client.del(`${P}note:short`); // the TTL firing
    Date.now = () => realNow() + 61_000;
    summary = await (await sweep()).json();
    Date.now = realNow;
    assert.equal(summary.purged, 1);
    assert.ok(![...r2.objects.keys()].some(k => k.startsWith(`${shortNs}/`)));
    assert.equal(await fixture.client.hGet(`${P}assets:nsbytes`, shortNs), null);

    // Per-note limits and the hourly reserve rate limit.
    await write("full", "# Full");
    const many = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`${String(i).padStart(2, "0")}${"x".repeat(20)}`, { t: "png", s: 1, c: 1 }]));
    await fixture.client.hSet(`${P}note:full`, "assets", JSON.stringify(many));
    assert.equal((await reserve({ key: "full", content_type: "image/png", size: 10 })).status, 409);
    await fixture.client.hSet(`${P}note:full`, "assets", JSON.stringify({ ["y".repeat(22)]: { t: "png", s: 50 * 1024 * 1024 - 5, c: 1 } }));
    assert.equal((await reserve({ key: "full", content_type: "image/png", size: 10 })).status, 413);
    await fixture.client.hSet(`${P}note:full`, "assets", "{}");
    for (let i = 0; i < 60; i++) assert.equal((await reserve({ key: "full", content_type: "image/png", size: 1 })).status, 200);
    const limited = await reserve({ key: "full", content_type: "image/png", size: 1 });
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get("retry-after")) > 0);

    // Storage alerts: one email per crossing, a hard stop at 9.5 GB, re-armed by the sweep below the hysteresis line.
    Object.assign(process.env, { RESEND_API_KEY: "re_test", ALERT_EMAIL_TO: "lawrence@example.com" });
    await write("big", "# Big");
    await fixture.client.set(`${P}assets:bytes`, String(8e9 - 5));
    assert.equal((await reserve({ key: "big", content_type: "image/png", size: 10 })).status, 200);
    assert.equal((await reserve({ key: "big", content_type: "image/png", size: 10 })).status, 200);
    await settle();
    assert.equal(emails.length, 1);
    assert.match(emails[0].subject, /passed 8\.00 GB/);
    assert.deepEqual(emails[0].to, ["lawrence@example.com"]);
    await sweep();
    assert.equal(emails.length, 1, "the daily sweep does not repeat it");
    await fixture.client.set(`${P}assets:bytes`, String(9.5e9));
    assert.equal((await reserve({ key: "big", content_type: "image/png", size: 10 })).status, 507);
    assert.equal((await reserve({ key: "big", content_type: "image/png", size: 10 })).status, 507);
    await settle();
    assert.equal(emails.length, 2);
    assert.match(emails[1].subject, /uploads stopped/);
    await fixture.client.set(`${P}assets:bytes`, String(7e9));
    await sweep();
    assert.equal(await fixture.client.exists(`${P}assets:alerts`), 0, "re-armed");
    await fixture.client.set(`${P}assets:bytes`, String(8e9 + 1));
    await sweep();
    assert.equal(emails.length, 3, "a new crossing alerts again");

    // Without Resend env the alert is logged, never thrown.
    delete process.env.RESEND_API_KEY;
    const { sendStorageAlert } = await import("../app/lib/alerts");
    assert.equal(await sendStorageAlert("warn", 8e9), true);
    assert.equal(emails.length, 3);

    // No R2 credentials reach Redis, and nothing stores image bytes there.
    const dump = JSON.stringify(await Promise.all((await fixture.client.keys("*")).map(async k => [k, await fixture.client.type(k)])));
    assert.ok(!dump.includes(R2_TEST_ENV.R2_SECRET_ACCESS_KEY));
  } finally {
    Date.now = realNow;
    globalThis.fetch = realFetch;
    unconfigure();
    await r2.close();
    await fixture.close();
  }
});
