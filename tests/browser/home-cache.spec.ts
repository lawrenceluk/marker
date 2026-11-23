import { randomUUID } from "node:crypto";
import { request as httpsRequest } from "node:https";
import { expect, test, request as playwrightRequest } from "@playwright/test";

test("Home and private variants stay isolated across requests", async ({ baseURL }) => {
  const anonymous = await playwrightRequest.newContext({ baseURL, ignoreHTTPSErrors: true });
  const privateBrowser = await playwrightRequest.newContext({ baseURL, ignoreHTTPSErrors: true });
  const keys = [randomUUID(), randomUUID()];
  const bodies = ["First synthetic cache sentinel", "Second synthetic cache sentinel"];

  async function checkHome() {
    const response = await anonymous.get("/");
    expect(response.ok()).toBe(true);
    expect(response.headers()["cache-control"]).toContain("private");
    expect(response.headers()["cache-control"]).toContain("no-store");
    const body = await response.text();
    expect(body).toContain("A private markdown pastebin");
    for (const marker of bodies) expect(body).not.toContain(marker);
  }

  async function checkPrivate(path: string, headers?: Record<string, string>, expected?: number) {
    const response = await privateBrowser.get(path, { headers, maxRedirects: 0 });
    const cache = response.headers()["cache-control"];
    expect(cache).toContain("private");
    expect(cache).toContain("no-store");
    expect(response.headers()["x-nextjs-cache"]).not.toBe("HIT");
    const body = await response.text();
    for (const [index, marker] of bodies.entries()) {
      if (index === expected) expect(body).toContain(marker);
      else expect(body).not.toContain(marker);
    }
    return response;
  }

  async function checkFreshRaw(path: string, headers?: Record<string, string>) {
    // Send the request-target verbatim and avoid inheriting cookies from other probes.
    const result = await new Promise<{ status: number; cache: string; hit?: string }>((resolve, reject) => {
      const req = httpsRequest(new URL(baseURL!), { path, headers, rejectUnauthorized: false }, response => {
        response.resume();
        response.on("end", () => resolve({
          status: response.statusCode ?? 0,
          cache: response.headers["cache-control"] ?? "",
          hit: String(response.headers["x-nextjs-cache"] ?? ""),
        }));
      });
      req.on("error", reject);
      req.setTimeout(10_000, () => req.destroy(new Error("Raw cache probe timed out")));
      req.end();
    });
    expect(result.cache, path).toContain("private");
    expect(result.cache, path).toContain("no-store");
    expect(result.hit, path).not.toBe("HIT");
    return result.status;
  }

  try {
    for (const [index, key] of keys.entries()) {
      expect((await privateBrowser.post("/api/content", { data: { key, content: `# ${bodies[index]}` } })).ok()).toBe(true);
    }

    await checkHome();
    await checkHome();
    await checkFreshRaw("/", { Cookie: "synthetic=1" });
    await checkFreshRaw("/", { Authorization: "Bearer synthetic" });
    await checkFreshRaw("/", { RSC: "1" });
    await checkFreshRaw("/", { "Next-Router-Prefetch": "1" });
    await checkFreshRaw("/", { "Next-Router-Segment-Prefetch": "/_tree" });
    await checkFreshRaw("/", { "Sec-Purpose": "prefetch" });
    await checkFreshRaw("/", { "Sec-Fetch-Dest": "iframe" });
    await checkFreshRaw("/", { "Sec-Fetch-Mode": "cors" });
    await checkFreshRaw("/", { Accept: "application/json" });
    await checkFreshRaw("/?_rsc=synthetic", { RSC: "1" });
    await checkFreshRaw("/", { "Next-Router-State-Tree": encodeURIComponent('["",{}]'), RSC: "1" });
    await checkFreshRaw("/", { "x-nextjs-data": "1" });
    await checkFreshRaw("/?%00=");
    await checkFreshRaw("/?other=1");
    for (const path of ["/?", "/?_rsc", "/?_rsc=", "/?_rsc=abc", "/?%5frsc=", "/?_rsc=&_rsc=abc"]) {
      expect(await checkFreshRaw(path)).toBe(200);
    }
    expect((await anonymous.get("/anonymous-home")).status()).toBe(404);
    await checkPrivate(`/?key=${keys[0]}&persist=1`, undefined, 0);
    await checkPrivate(`/?%6bey=${keys[1]}&%70ersist=1`, undefined, 1);
    await checkPrivate(`/?key=${keys[0]}&key=${keys[1]}&persist=1`);
    await checkPrivate(`/?key=${keys[1]}&persist=1&persist=1`);
    for (const key of keys) {
      const og = await privateBrowser.get(`/og?key=${key}&v=4`);
      expect(og.ok()).toBe(true);
      expect(og.headers()["content-type"]).toBe("image/png");
      expect(og.headers()["cache-control"]).toContain("private");
      expect(og.headers()["cache-control"]).toContain("no-store");
    }
    const oneOff = await checkPrivate(`/?key=${keys[0]}`);
    expect(oneOff.status()).toBe(307);
    await checkPrivate(oneOff.headers().location, undefined, 0);
    await checkPrivate("/");
    await checkHome();

    const head = await privateBrowser.head("/");
    expect(head.headers()["cache-control"]).toContain("private");
    expect(head.headers()["cache-control"]).toContain("no-store");
  } finally {
    await Promise.all(keys.map(key => privateBrowser.delete("/api/content", { data: { key } })));
    await anonymous.dispose();
    await privateBrowser.dispose();
  }
});
