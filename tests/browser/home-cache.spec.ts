import { randomUUID } from "node:crypto";
import { expect, test, request as playwrightRequest } from "@playwright/test";

test("Home and private variants stay isolated across requests", async ({ baseURL }) => {
  const anonymous = await playwrightRequest.newContext({ baseURL, ignoreHTTPSErrors: true });
  const privateBrowser = await playwrightRequest.newContext({ baseURL, ignoreHTTPSErrors: true });
  const keys = [randomUUID(), randomUUID()];
  const bodies = ["First synthetic cache sentinel", "Second synthetic cache sentinel"];

  async function checkHome() {
    const response = await anonymous.get("/");
    expect(response.ok()).toBe(true);
    expect(response.headers()["cache-control"]).not.toContain("private");
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

  try {
    for (const [index, key] of keys.entries()) {
      expect((await privateBrowser.post("/api/content", { data: { key, content: `# ${bodies[index]}` } })).ok()).toBe(true);
    }

    await checkHome();
    await checkHome();
    await checkPrivate("/", { Cookie: "synthetic=1" });
    await checkPrivate("/", { Authorization: "Bearer synthetic" });
    await checkPrivate("/", { RSC: "1" });
    await checkPrivate("/", { "Next-Router-Prefetch": "1" });
    await checkPrivate("/", { "Next-Router-Segment-Prefetch": "/_tree" });
    await checkPrivate("/", { "Sec-Purpose": "prefetch" });
    await checkPrivate("/", { "Sec-Fetch-Dest": "iframe" });
    await checkPrivate("/", { "Sec-Fetch-Mode": "cors" });
    await checkPrivate("/", { Accept: "application/json" });
    await checkPrivate("/?_rsc=synthetic", { RSC: "1" });
    await checkPrivate("/", { "Next-Router-State-Tree": encodeURIComponent('["",{}]'), RSC: "1" });
    await checkPrivate("/", { "x-nextjs-data": "1" });
    await checkPrivate("/?%00=");
    await checkPrivate("/?other=1");
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
