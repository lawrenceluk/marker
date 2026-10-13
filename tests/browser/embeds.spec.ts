import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";

function png(width: number, height: number, rgb: [number, number, number]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3).map((_, i) => rgb[i % 3])]);
  const pixels = deflateSync(Buffer.concat(Array.from({ length: height }, () => row)));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", pixels), chunk("IEND", Buffer.alloc(0))]);
}

const CHART = `<!doctype html>
<html><head>
<script src="https://cdn.jsdelivr.net/npm/fake-chart@1.0.0/dist/chart.min.js"></script>
<script src="https://unpkg.com/fake-chart@1.0.0/dist/chart.min.js"></script>
<style>#tall { height: 700px; }</style>
</head><body>
<div id="chart">Latency chart</div>
<button id="link" onclick="marker.openLink('https://example.com/report')">Source</button>
<div id="tall"></div>
<script>
  document.getElementById("chart").dataset.lib = String(window.fakeChart);
  new Image().src = "https://beacon.example.test/pixel.png";
</script>
</body></html>`;

/** Kills its own heartbeat after starting, which the parent can't tell apart from a hang. */
const FROZEN = `<p id="frozen">Frozen</p><script>setTimeout(function () { for (var i = 1; i < 10000; i++) clearInterval(i); }, 300);</script>`;

const MISSING_ID = "AAAAAAAAAAAAAAAAAAAAAA";
const GEIST = readFileSync("node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2");

async function thirdParties(page: Page) {
  const blocked: string[] = [];
  await page.route("https://cdn.jsdelivr.net/npm/**", route => {
    const url = route.request().url();
    if (url.endsWith(".woff2")) return route.fulfill({ status: 200, contentType: "font/woff2", body: GEIST, headers: { "access-control-allow-origin": "*" } });
    return route.fulfill({ status: 200, contentType: "text/javascript", body: "window.fakeChart = 42;", headers: { "access-control-allow-origin": "*" } });
  });
  for (const pattern of ["https://unpkg.com/**", "https://beacon.example.test/**"]) {
    await page.route(pattern, route => {
      blocked.push(route.request().url());
      return route.fulfill({ status: 200, contentType: "text/javascript", body: "window.unpkgLoaded = true;" });
    });
  }
  return blocked;
}

async function upload(request: import("@playwright/test").APIRequestContext, key: string, contentType: string, body: Buffer | string) {
  const res = await request.post("/api/assets", { data: { key, content_type: contentType, data_base64: Buffer.from(body).toString("base64") } });
  expect(res.status()).toBe(200);
  return (await res.json()) as { asset_id: string; markdown: string };
}

test("an agent embed runs sandboxed and themed, resizes, has no network, and links behind a confirm", async ({ page, request }, info) => {
  const key = `embeds-${info.project.name}-${Date.now()}`;
  await request.post("/api/content", { data: { key, content: "# Report\n" } });
  const chart = await upload(request, key, "text/html", CHART);
  expect(chart.markdown).toBe(`![](marker-embed:${chart.asset_id})`);
  const poster = await upload(request, key, "image/png", png(320, 180, [230, 230, 230]));
  await request.post("/api/content", {
    data: { key, content: `# Report\n\n![Latency by region](marker-embed:${chart.asset_id} "h=300 poster=marker-asset:${poster.asset_id}")\n\n![Gone chart](marker-embed:${MISSING_ID})\n\nAfter.` },
  });

  const blocked = await thirdParties(page);
  await page.addInitScript(() => {
    if (window.top !== window) return;
    const seen: string[] = [];
    (window as unknown as { __violations: string[] }).__violations = seen;
    document.addEventListener("securitypolicyviolation", event => seen.push(`${event.violatedDirective} ${event.blockedURI}`));
  });
  const warnings: string[] = [];
  page.on("console", message => { if (message.type() === "warning") warnings.push(message.text()); });
  const embedNavigations: string[] = [];
  page.on("framenavigated", frame => { if (frame !== page.mainFrame()) embedNavigations.push(frame.url()); });

  const response = await page.goto(`/?key=${key}&persist=1`);
  const headers = response!.headers();
  expect(headers["content-security-policy"]).toMatch(/frame-src 'self'/);
  expect(headers["content-security-policy"]).toMatch(/frame-ancestors 'none'/);
  expect(headers["content-security-policy-report-only"]).toBeUndefined();

  const plate = page.locator('.note-embed-plate[data-mode="inline"]');
  const iframe = plate.locator("iframe");
  await expect(iframe).toHaveAttribute("sandbox", "allow-scripts");
  await expect(iframe).toHaveAttribute("referrerpolicy", "no-referrer");
  await expect(iframe).toHaveAttribute("allow", "");
  await expect(iframe).toHaveAttribute("credentialless", "");
  expect(await iframe.getAttribute("src")).toMatch(/^https:\/\/127\.0\.0\.1:17382\/__r2\/marker-assets-test\/embed-shell-[0-9a-f]{16}\.html\?.+#src=https%3A%2F%2F127\.0\.0\.1%3A17382/);
  expect(await iframe.getAttribute("src")).not.toContain(key);
  await expect(iframe).toHaveAttribute("data-ready", "");
  await expect(page.locator(".note-embed-poster")).toBeHidden();
  await expect(page.locator(".note-embed-caption").first()).toHaveText("Latency by region");
  await expect(page.locator('.note-embed[data-state="missing"]')).toHaveText("Gone chart");

  const frame = page.frameLocator('.note-embed-plate[data-mode="inline"] iframe');
  await expect(frame.locator("#chart")).toHaveText("Latency chart");
  await expect(frame.locator("#chart"), "pinned jsDelivr scripts load").toHaveAttribute("data-lib", "42");
  await expect.poll(() => plate.evaluate(element => element.getBoundingClientRect().height), { message: "the frame grows to its content" }).toBeGreaterThan(700);

  const content = (await (await iframe.elementHandle())!.contentFrame())!;
  const inside = await content.evaluate(async () => {
    const attempt = async (run: () => unknown) => {
      try {
        await run();
        return "allowed";
      } catch {
        return "blocked";
      }
    };
    const root = getComputedStyle(document.documentElement);
    return {
      origin: self.origin,
      locationOrigin: location.origin,
      frameSandbox: (() => {
        try {
          return window.frameElement ? "readable" : "hidden";
        } catch {
          return "blocked";
        }
      })(),
      unpkg: (window as unknown as { unpkgLoaded?: boolean }).unpkgLoaded ?? null,
      fetch: await attempt(() => fetch("/api/content")),
      cookie: await attempt(() => document.cookie),
      storage: await attempt(() => localStorage.length),
      parent: await attempt(() => window.parent.document.title),
      bridge: typeof (window as unknown as { marker?: { openLink?: unknown } }).marker?.openLink,
      paper: root.getPropertyValue("--paper").trim(),
      background: root.backgroundColor,
      font: getComputedStyle(document.body).fontFamily,
      policies: [...document.querySelectorAll<HTMLMetaElement>('meta[http-equiv="Content-Security-Policy"]')].map(meta => meta.content),
    };
  });
  expect(inside.origin).toBe("null");
  expect(inside.locationOrigin, "location reflects the URL, not the document's opaque origin").toBe(new URL(info.project.use.baseURL!).origin);
  expect(inside.frameSandbox, "an opaque document can't reach its parent's iframe element").toBe("hidden");
  expect(await iframe.evaluate(element => (element as HTMLIFrameElement).sandbox.value)).toBe("allow-scripts");
  expect(embedNavigations.filter(url => /embed-shell-[0-9a-f]{16}\.html/.test(url)), "the shell loads once, with no redirect or re-navigation").toHaveLength(1);
  expect(embedNavigations.every(url => /embed-shell-[0-9a-f]{16}\.html/.test(url))).toBe(true);
  expect(inside.unpkg, "unpkg is outside the script allowlist").toBeNull();
  expect(inside.fetch).toBe("blocked");
  expect(inside.cookie).toBe("blocked");
  expect(inside.storage).toBe("blocked");
  expect(inside.parent).toBe("blocked");
  expect(inside.bridge).toBe("function");
  expect(inside.font).toMatch(/^"?Geist"?,/);
  expect(inside.policies.some(policy => policy.includes("connect-src 'none'"))).toBe(true);
  const noteBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(inside.background).toBe(noteBackground);
  expect(inside.paper).toBe(noteBackground);
  await page.waitForTimeout(300);
  expect(blocked, "no request leaves for unpkg or an image beacon").toEqual([]);
  await expect.poll(() => warnings.some(text => text.includes("[marker] embed error:") && text.includes("connect-src"))).toBe(true);

  const dialogs: string[] = [];
  page.on("dialog", dialog => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  const pages = page.context().pages().length;
  await frame.locator("#link").click();
  await expect.poll(() => dialogs.length).toBe(1);
  expect(dialogs[0]).toContain("example.com");
  expect(dialogs[0]).toContain("https://example.com/report");
  expect(page.context().pages().length, "declining opens nothing").toBe(pages);

  await page.screenshot({ path: `test-results/embeds-view-${info.project.name}.png`, fullPage: true });
  expect(await page.evaluate(() => (window as unknown as { __violations: string[] }).__violations)).toEqual([]);
});

test("embeds start on screen, stop for a hidden tab, are swapped out when frozen, reload, and expand", async ({ page, request }, info) => {
  const key = `embeds-life-${info.project.name}-${Date.now()}`;
  await request.post("/api/content", { data: { key, content: "# Life\n" } });
  const chart = await upload(request, key, "text/html", CHART);
  const frozen = await upload(request, key, "text/html", FROZEN);
  const filler = "A paragraph that pushes the embeds below the fold.\n\n".repeat(60);
  await request.post("/api/content", {
    data: { key, content: `# Life\n\n${filler}![Live chart](marker-embed:${chart.asset_id})\n\n${filler}![Frozen chart](marker-embed:${frozen.asset_id} "h=200")\n` },
  });
  await thirdParties(page);
  await page.goto(`/?key=${key}&persist=1`);

  const live = page.getByRole("group", { name: "Live chart" });
  const stuck = page.getByRole("group", { name: "Frozen chart" });
  await expect(live.locator(".note-embed-plate")).toBeAttached();
  await expect(page.locator(".note-embed iframe"), "nothing runs off-screen").toHaveCount(0);

  await live.scrollIntoViewIfNeeded();
  await expect(live.locator("iframe")).toHaveAttribute("data-ready", "");
  await expect(stuck.locator("iframe")).toHaveCount(0);

  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(live.locator("iframe"), "a hidden tab stops the embed").toHaveCount(0);
  await page.evaluate(() => {
    delete (document as { visibilityState?: unknown }).visibilityState;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(live.locator("iframe"), "and it restarts on return").toHaveAttribute("data-ready", "");

  await live.getByRole("button", { name: "Expand embed" }).click();
  const dialog = page.getByRole("dialog", { name: "Live chart" });
  await expect(dialog.locator("iframe")).toHaveAttribute("data-ready", "");
  await expect(live.locator(".note-embed-plate > iframe"), "the inline copy pauses while expanded").toHaveCount(0);
  await page.screenshot({ path: `test-results/embeds-expanded-${info.project.name}.png` });
  await dialog.getByRole("button", { name: "Close embed" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(live.locator("iframe")).toHaveAttribute("data-ready", "");

  await stuck.scrollIntoViewIfNeeded();
  await expect(stuck.locator("iframe")).toHaveAttribute("data-ready", "");
  await expect(stuck.locator(".note-embed-plate")).toHaveAttribute("data-phase", "stalled", { timeout: 15_000 });
  await expect(stuck.locator("iframe")).toHaveCount(0);
  await expect(stuck.getByRole("status")).toHaveText("Embed stopped. Reload to try again.");
  await expect(stuck.getByRole("button", { name: "Reload embed" })).toBeVisible();
  await stuck.getByRole("button", { name: "Reload embed" }).click();
  await expect(stuck.locator("iframe")).toHaveAttribute("data-ready", "");
});

const MARGINS = `<p style="margin:24px 0">Top</p><div style="height:200px"></div><pre>last line</pre>`;
const SHORT = `<p>Short</p>`;

test("the frame fits margins that escape the body, shrinks to short content, and the shell needs the sandbox", async ({ page, request }, info) => {
  const key = `embeds-size-${info.project.name}-${Date.now()}`;
  await request.post("/api/content", { data: { key, content: "# Size\n" } });
  const margins = await upload(request, key, "text/html", MARGINS);
  const short = await upload(request, key, "text/html", SHORT);
  await request.post("/api/content", {
    data: { key, content: `# Size\n\n![Short](marker-embed:${short.asset_id} "h=600")\n\n![Margins](marker-embed:${margins.asset_id} "h=120")\n` },
  });
  await thirdParties(page);
  await page.goto(`/?key=${key}&persist=1`);

  const shortFrame = page.getByRole("group", { name: "Short" }).locator("iframe");
  await expect(shortFrame).toHaveAttribute("data-ready", "");
  await expect.poll(() => shortFrame.evaluate(element => element.getBoundingClientRect().height), { message: "h is only the first paint" }).toBeLessThan(200);

  const group = page.getByRole("group", { name: "Margins" });
  await group.scrollIntoViewIfNeeded();
  const marginFrame = group.locator("iframe");
  await expect(marginFrame).toHaveAttribute("data-ready", "");
  const content = (await (await marginFrame.elementHandle())!.contentFrame())!;
  await expect.poll(async () => {
    const m = await content.evaluate(() => {
      const pre = document.querySelector("pre")!;
      return { bottom: pre.getBoundingClientRect().bottom + parseFloat(getComputedStyle(pre).marginBottom), viewport: innerHeight, scroll: document.documentElement.scrollHeight };
    });
    return m.bottom <= m.viewport && m.scroll <= m.viewport;
  }, { message: "the trailing <pre> margin and the first child's top margin fit in the frame" }).toBe(true);

  const { urls, embed_shell } = await (await request.get(`/api/assets/urls?key=${key}`)).json();
  await page.evaluate(src => {
    const frame = document.createElement("iframe");
    frame.id = "unsandboxed";
    frame.src = src;
    document.body.append(frame);
  }, `${embed_shell}#src=${encodeURIComponent(urls[short.asset_id])}`);
  await expect(page.frameLocator("#unsandboxed").locator("body")).toHaveText("This embed only runs in a sandboxed frame.");
});

test("the raw file is served as text and the shell refuses to run outside a frame", async ({ page, request }, info) => {
  const key = `embeds-direct-${info.project.name}-${Date.now()}`;
  await request.post("/api/content", { data: { key, content: "# Direct\n" } });
  const chart = await upload(request, key, "text/html", CHART);
  const { urls, embed_shell } = await (await request.get(`/api/assets/urls?key=${key}`)).json();
  const raw = await request.get(urls[chart.asset_id]);
  expect(raw.headers()["content-type"]).toBe("text/plain; charset=utf-8");
  expect(await raw.text()).toBe(CHART);

  await thirdParties(page);
  await page.goto(`${embed_shell}#src=${encodeURIComponent(urls[chart.asset_id])}`);
  await expect(page.locator("body")).toHaveText("This embed only runs inside a Marker note.");
  await expect(page.locator("#chart")).toHaveCount(0);
});
