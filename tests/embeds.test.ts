import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { startRedisRest } from "./helpers/redis-rest";
import { R2_TEST_ENV, startR2Mock } from "./helpers/r2-mock";
import {
  EMBED_MESSAGE_MAX_BYTES,
  clampHeight,
  embedCsp,
  messageBudget,
  originAllowed,
  parseEmbedMessage,
  parseEmbedParams,
  presignedExpiry,
} from "../app/lib/embedPolicy";
import { embedShellHtml } from "../app/lib/embedShell";
import { ogBodyText, previewFromMarkdown } from "../app/lib/preview";

const P = "marker-commenting-preview-v1:";
const ID = "AAAAAAAAAAAAAAAAAAAAAA";
const POSTER = "BBBBBBBBBBBBBBBBBBBBBB";
const HTML = Buffer.from('<!doctype html><div id="chart">Latency ≤ 40 ms</div><script>document.getElementById("chart").textContent += "!"</script>');
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

const directives = (csp: string) => Object.fromEntries(csp.split(/;\s*/).map(d => {
  const [name, ...values] = d.trim().split(/\s+/);
  return [name, values];
}));

test("the embed CSP: no network, scripts only from jsDelivr /npm/, data-only images", () => {
  const csp = directives(embedCsp());
  assert.deepEqual(csp["default-src"], ["'none'"]);
  assert.deepEqual(csp["script-src"], ["'unsafe-inline'", "'unsafe-eval'", "https://cdn.jsdelivr.net/npm/"]);
  assert.deepEqual(csp["style-src"], ["'unsafe-inline'", "https://cdn.jsdelivr.net/npm/", "https://fonts.googleapis.com"]);
  assert.deepEqual(csp["font-src"], ["https://cdn.jsdelivr.net/npm/", "https://fonts.gstatic.com", "data:"]);
  assert.deepEqual(csp["img-src"], ["data:", "blob:"]);
  assert.deepEqual(csp["media-src"], ["data:", "blob:"]);
  assert.deepEqual(csp["connect-src"], ["'none'"]);
  for (const name of ["worker-src", "child-src", "frame-src", "object-src", "form-action", "base-uri", "manifest-src"]) {
    assert.deepEqual(csp[name], ["'none'"], name);
  }
  assert.equal(csp["prefetch-src"], undefined, "Chromium rejects prefetch-src as unrecognized");
  assert.ok(!embedCsp().includes("unpkg"));
  assert.ok(!embedCsp().includes("https:;") && !/\shttps:(\s|;|$)/.test(embedCsp()), "no bare https: source");
  assert.deepEqual(directives(embedCsp("https://acct.r2.cloudflarestorage.com"))["connect-src"], ["https://acct.r2.cloudflarestorage.com"]);
});

test("reference params from the title slot", () => {
  assert.deepEqual(parseEmbedParams(undefined), { h: null, ratio: null, poster: null });
  assert.deepEqual(parseEmbedParams(`h=420 ratio=16:9 poster=marker-asset:${POSTER}`), { h: 420, ratio: [16, 9], poster: POSTER });
  assert.equal(parseEmbedParams("h=5").h, 120);
  assert.equal(parseEmbedParams("h=99999").h, 2000);
  assert.equal(parseEmbedParams("h=abc").h, null);
  assert.equal(parseEmbedParams("ratio=0:9").ratio, null);
  assert.equal(parseEmbedParams("poster=https://evil.example/x.png").poster, null);
  assert.equal(parseEmbedParams("poster=marker-asset:short").poster, null);
  assert.equal(clampHeight(3000, 900), 900);
  assert.equal(clampHeight(50, 900), 120);
});

test("bridge messages are schema-checked, size-capped and rate-limited", () => {
  assert.deepEqual(parseEmbedMessage({ type: "heartbeat" }), { type: "heartbeat" });
  assert.deepEqual(parseEmbedMessage({ type: "ready", extra: 1 }), { type: "ready" });
  assert.deepEqual(parseEmbedMessage({ type: "resize", height: 480 }), { type: "resize", height: 480 });
  assert.equal(parseEmbedMessage({ type: "resize", height: "480" }), null);
  assert.equal(parseEmbedMessage({ type: "resize", height: Infinity }), null);
  assert.deepEqual(parseEmbedMessage({ type: "openLink", url: "https://example.com/a b" }), { type: "openLink", url: "https://example.com/a%20b" });
  for (const url of ["http://example.com", "javascript:alert(1)", "data:text/html,x", "https://user:pw@example.com", 42]) {
    assert.equal(parseEmbedMessage({ type: "openLink", url }), null, String(url));
  }
  assert.equal(parseEmbedMessage({ type: "error", message: "x".repeat(2000) })?.type, "error");
  assert.equal((parseEmbedMessage({ type: "error", message: "x".repeat(2000) }) as { message: string }).message.length, 500);
  assert.equal(parseEmbedMessage({ type: "error", message: "x".repeat(EMBED_MESSAGE_MAX_BYTES) }), null, "over 8 KB is dropped");
  for (const bad of [null, "resize", [], { type: "init" }, { type: "theme" }, { type: "navigate", url: "https://x" }]) assert.equal(parseEmbedMessage(bad), null);
  const cyclic: Record<string, unknown> = { type: "ready" };
  cyclic.self = cyclic;
  assert.equal(parseEmbedMessage(cyclic), null);

  const allow = messageBudget();
  const results = Array.from({ length: 60 }, () => allow(1000));
  assert.equal(results.filter(Boolean).length, 50);
  assert.equal(allow(2001), true, "the window slides");
});

test("presigned expiry and parent origin allowlist", async () => {
  const { embedParentOrigins } = await import("../app/lib/embeds");
  assert.equal(presignedExpiry("https://x.test/o?X-Amz-Date=20261013T050000Z&X-Amz-Expires=7200"), Date.UTC(2026, 9, 13, 7));
  assert.equal(presignedExpiry("https://x.test/o"), null);
  assert.equal(presignedExpiry("not a url"), null);
  const allowed = ["https://marker.luk.xyz", "https://*.vercel.app"];
  assert.ok(originAllowed("https://marker.luk.xyz", allowed));
  assert.ok(originAllowed("https://marker-git-x.vercel.app", allowed));
  assert.ok(!originAllowed("https://vercel.app", allowed));
  assert.ok(!originAllowed("https://evil.example", allowed));
  assert.ok(!originAllowed("http://marker.luk.xyz", allowed));
  assert.deepEqual(embedParentOrigins({}), allowed);
  assert.deepEqual(embedParentOrigins({ EMBED_PARENT_ORIGINS: " https://a.test , https://b.test" }), ["https://a.test", "https://b.test"]);
});

test("the shell: CSP before any script, one script element, the agent document gets connect-src 'none'", () => {
  const html = embedShellHtml({ storageOrigin: "https://acct.r2.cloudflarestorage.com", parentOrigins: ["https://marker.luk.xyz"] });
  const meta = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html);
  assert.ok(meta && meta.index < html.indexOf("<script"), "the shell's CSP precedes its script");
  assert.deepEqual(directives(meta![1])["connect-src"], ["https://acct.r2.cloudflarestorage.com"]);
  assert.equal(html.match(/<script/g)?.length, 1);
  assert.equal(html.match(/<\/script/gi)?.length, 1, "nothing inside the boot script can close it");
  assert.ok(!html.slice(html.indexOf("<script>"), html.lastIndexOf("</script>")).includes("<!--"));
  assert.ok(html.includes('content="off"'), "DNS prefetch off");
  assert.ok(html.includes("window.top === window"), "refuses to run top-level");
  assert.ok(html.includes('\\"https://marker.luk.xyz\\"') || html.includes('["https://marker.luk.xyz"]'));

  const boot = html.slice(html.indexOf("<script>") + 8, html.lastIndexOf("</script>"));
  const head = JSON.parse(/var HEAD = ("(?:[^"\\]|\\.)*");/.exec(boot)![1]) as string;
  const childCsp = /content="([^"]+)"/.exec(head)![1];
  assert.equal(childCsp, embedCsp());
  assert.ok(head.indexOf("Content-Security-Policy") < head.indexOf("<script>"), "the agent document's CSP precedes the bridge");
  assert.ok(head.includes("geist@1.7.2/dist/fonts/geist-sans/Geist-Variable.woff2"));
  assert.doesNotThrow(() => new Function(boot), "the boot script parses");
  const bridge = JSON.parse(/var BRIDGE = ("(?:[^"\\]|\\.)*");/.exec(boot)![1]) as string;
  assert.doesNotThrow(() => new Function(bridge), "the bridge parses");
  for (const type of ["heartbeat", "ready", "resize", "openLink", "error"]) assert.ok(bridge.includes(`type: "${type}"`), type);
});

test("embed HTML checks for base64 uploads", async () => {
  const { embedHtmlProblem } = await import("../app/lib/embeds");
  assert.equal(embedHtmlProblem(HTML), null);
  assert.match(embedHtmlProblem(Buffer.from([0xff, 0xfe, 0x00]))!, /UTF-8/);
  assert.match(embedHtmlProblem(Buffer.from('<meta http-equiv="refresh" content="0;url=https://evil.example">'))!, /refresh/);
  assert.match(embedHtmlProblem(Buffer.from("<META HTTP-EQUIV=Refresh CONTENT=0>"))!, /refresh/);
  assert.match(embedHtmlProblem(Buffer.from("a\u0000b"))!, /NUL/);
});

test("link previews drop embeds", () => {
  assert.equal(previewFromMarkdown(`![Latency](marker-embed:${ID} "h=420")\n# Report\nBody`)?.title, "Report");
  assert.ok(!ogBodyText(`Before ![chart](marker-embed:${ID}) after`).includes("marker-embed"));
});

test("embeds: reserve, text/plain storage, shell upload, limits shared with images, and reference tracking", async () => {
  const fixture = await startRedisRest();
  const r2 = await startR2Mock();
  Object.assign(process.env, R2_TEST_ENV, { R2_ENDPOINT: r2.url, KV_REST_API_URL: fixture.url, KV_REST_API_TOKEN: "synthetic", VERCEL_ENV: "preview" });
  const realFetch = globalThis.fetch;
  try {
    const content = await import("../app/api/content/route");
    const assets = await import("../app/api/assets/route");
    const urls = await import("../app/api/assets/urls/route");
    const req = (path: string, init?: { method?: string; body?: unknown }) =>
      new NextRequest(`https://marker.test${path}`, {
        method: init?.method ?? "GET",
        body: init?.body === undefined ? undefined : JSON.stringify(init.body),
        headers: { "content-type": "application/json" },
      });
    const write = (key: string, text: string) => content.POST(req("/api/content", { method: "POST", body: { key, content: text } }));
    const read = async (key: string) => (await content.GET(req(`/api/content?key=${key}`))).json();
    const reserve = (body: Record<string, unknown>) => assets.POST(req("/api/assets", { method: "POST", body }));
    const settle = () => new Promise(r => setTimeout(r, 100));

    await write("report", "# Report");

    // Validation: size cap on both paths, UTF-8, no meta refresh.
    assert.equal((await reserve({ key: "report", content_type: "text/html", size: 512 * 1024 + 1 })).status, 413);
    assert.equal((await reserve({ key: "report", content_type: "text/html", data_base64: Buffer.alloc(512 * 1024 + 1, 0x61).toString("base64") })).status, 413);
    assert.equal((await reserve({ key: "report", content_type: "text/html", data_base64: Buffer.from([0xff, 0xfe]).toString("base64") })).status, 400);
    const refresh = await reserve({ key: "report", content_type: "text/html", data_base64: Buffer.from('<meta http-equiv="refresh" content="0">').toString("base64") });
    assert.equal(refresh.status, 400);
    assert.match((await refresh.json()).error, /refresh/);
    assert.equal((await reserve({ key: "report", content_type: "text/html; charset=utf-8", size: 512 * 1024 })).status, 200, "512 KiB exactly is fine");

    // Base64: stored as text/plain so the raw object never renders; markdown uses marker-embed.
    const one = await (await reserve({ key: "report", content_type: "text/html", data_base64: HTML.toString("base64") })).json();
    assert.equal(one.uploaded, true);
    assert.equal(one.type, "text/html");
    assert.equal(one.markdown, `![](marker-embed:${one.asset_id})`);
    const ns = (await fixture.client.hGetAll(`${P}note:report`)).asset_ns;
    assert.equal(r2.objects.get(`${ns}/${one.asset_id}`)?.contentType, "text/plain; charset=utf-8");
    const raw = await realFetch(one.url);
    assert.equal(raw.headers.get("content-type"), "text/plain; charset=utf-8");
    assert.deepEqual(Buffer.from(await raw.arrayBuffer()), HTML);

    // The first embed reserve puts the shell in the bucket, once.
    await settle();
    const shell = r2.objects.get("embed-shell-v1.html");
    assert.ok(shell, "shell uploaded");
    assert.equal(shell.contentType, "text/html; charset=utf-8");
    assert.ok(shell.body.toString().includes(`connect-src ${new URL(r2.url).origin}`));
    const shellPuts = r2.log.filter(l => l.startsWith("PUT embed-shell")).length;
    await reserve({ key: "report", content_type: "text/html", size: 10 });
    await settle();
    assert.equal(r2.log.filter(l => l.startsWith("PUT embed-shell")).length, shellPuts);

    // Presigned PUT locks text/plain and the length.
    const two = await (await reserve({ key: "report", content_type: "text/html", size: HTML.length })).json();
    assert.deepEqual(two.upload_headers, { "Content-Type": "text/plain; charset=utf-8", "Content-Length": String(HTML.length) });
    assert.equal((await realFetch(two.upload_url, { method: "PUT", body: HTML, headers: { "Content-Type": "text/html" } })).status, 403);
    assert.equal((await realFetch(two.upload_url, { method: "PUT", body: HTML, headers: two.upload_headers })).status, 200);

    // The shell URL comes with the note's view URLs.
    const fresh = await (await urls.GET(req("/api/assets/urls?key=report"))).json();
    assert.equal(fresh.urls[one.asset_id], one.url);
    const shellView = await realFetch(fresh.embed_shell);
    assert.equal(shellView.status, 200);
    assert.equal(shellView.headers.get("content-type"), "text/html; charset=utf-8");

    // Listing, then reference tracking: an embed and its poster both count as referenced.
    const poster = await (await reserve({ key: "report", content_type: "image/png", data_base64: PNG.toString("base64") })).json();
    await write("report", `# Report\n\n![Latency](marker-embed:${one.asset_id} "h=420 poster=marker-asset:${poster.asset_id}")\n`);
    const listed = (await read("report")).assets as { id: string; type: string; markdown: string; delete_after: number | null }[];
    const byId = Object.fromEntries(listed.map(a => [a.id, a]));
    assert.equal(byId[one.asset_id].type, "text/html");
    assert.equal(byId[one.asset_id].markdown, `![](marker-embed:${one.asset_id})`);
    assert.equal(byId[one.asset_id].delete_after, null);
    assert.equal(byId[poster.asset_id].delete_after, null);
    assert.ok(byId[two.asset_id].delete_after, "an unreferenced embed is scheduled for deletion like an image");

    // Ten embeds per note; images still fit under the shared 100-asset budget.
    await write("many", "# Many");
    const tenEmbeds = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`${String(i).padStart(2, "0")}${"e".repeat(20)}`, { t: "html", s: 1, c: 1 }]));
    await fixture.client.hSet(`${P}note:many`, "assets", JSON.stringify(tenEmbeds));
    const eleventh = await reserve({ key: "many", content_type: "text/html", size: 10 });
    assert.equal(eleventh.status, 409);
    assert.match((await eleventh.json()).error, /10 embeds/);
    assert.equal((await reserve({ key: "many", content_type: "image/png", size: 10 })).status, 200);
    const full = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`${String(i).padStart(3, "0")}${"p".repeat(19)}`, { t: "png", s: 1, c: 1 }]));
    await fixture.client.hSet(`${P}note:many`, "assets", JSON.stringify(full));
    assert.equal((await reserve({ key: "many", content_type: "text/html", size: 10 })).status, 409, "the 100-asset budget is shared");
    await fixture.client.hSet(`${P}note:many`, "assets", JSON.stringify({ ["q".repeat(22)]: { t: "png", s: 50 * 1024 * 1024 - 5, c: 1 } }));
    assert.equal((await reserve({ key: "many", content_type: "text/html", size: 10 })).status, 413, "the 50 MiB budget is shared");
  } finally {
    globalThis.fetch = realFetch;
    for (const k of [...Object.keys(R2_TEST_ENV), "R2_ENDPOINT"]) delete process.env[k];
    await r2.close();
    await fixture.close();
  }
});
