import { test, expect, type Page } from "@playwright/test";
import { SPEC_CONTENT, SPEC_KEY } from "../../app/lib/spec-sample";

async function selectByGesture(page: Page, point: { x: number; y: number }, projectName: string) {
  if (projectName === "iphone-webkit") {
    await page.touchscreen.tap(point.x, point.y);
    await page.touchscreen.tap(point.x, point.y);
  } else await page.mouse.dblclick(point.x, point.y);
}

test("Preview spec is substantive and mobile requires two taps without stealing links or scroll", async ({ browser, page, request }, info) => {
  const mobileContext = info.project.name === "chromium"
    ? await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true })
    : null;
  const mobilePage = mobileContext ? await mobileContext.newPage() : page;
  try {
    let calls = 0;
    await mobilePage.route("**/api/tap-select", async route => {
      calls++;
      const body = route.request().postDataJSON();
      const ranking = body.candidates.map((_: unknown, index: number) => index);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ranking, source: "jev", timing: { route_ms: 12, typesafe_ms: 9, outcome: "jev", region: "sfo1" } }) });
    });
    await mobilePage.goto(`/?key=${SPEC_KEY}&persist=1&tap=jev&tapwait=700`);
    await expect(mobilePage.getByRole("heading", { name: /Atlas Tool Share/u })).toBeVisible();
    await expect(mobilePage.getByRole("link", { name: "Open selection spec" })).toBeVisible();
    const note = await (await request.get(`/api/content?key=${SPEC_KEY}`)).json();
    expect(note.content).toBe(SPEC_CONTENT);
    expect(note.content).toContain("Reservations do not guarantee pickup.");
    expect(note.content).toContain("inspection wins");
    expect(note.content).toContain("[safety checklist](#safety)");
    expect(await mobilePage.locator(".tap-select-preview").evaluate(element => getComputedStyle(element).touchAction)).toBe("manipulation");
    const point = await mobilePage.locator(".prose [data-source-start]").filter({ hasText: "reliable handoff" }).first().evaluate(element => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const offset = node.textContent?.indexOf("handoff") ?? -1;
        if (offset < 0) continue;
        const range = document.createRange();
        range.setStart(node, offset + 2);
        range.setEnd(node, offset + 3);
        const rect = range.getBoundingClientRect();
        return { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
      }
      throw new Error("Synthetic handoff target missing");
    });
    await mobilePage.touchscreen.tap(point.x, point.y);
    await mobilePage.waitForTimeout(400);
    expect(calls).toBe(0);
    await expect(mobilePage.getByRole("status", { name: "Choosing quote" })).toHaveCount(0);
    await expect(mobilePage.getByRole("button", { name: "Comment on selection" })).toHaveCount(0);
    await mobilePage.touchscreen.tap(point.x, point.y);
    await mobilePage.touchscreen.tap(point.x, point.y);
    await expect.poll(() => calls).toBe(1);
    await expect(mobilePage.locator(".comment-auto-status")).toContainText(/jev · \d+ms · API 12ms · Jev 9ms · outside \d+ms · sfo1/u);
    await expect(mobilePage.getByRole("button", { name: "Comment on selection" })).toBeVisible();
    await mobilePage.getByRole("button", { name: "Larger selection" }).tap();
    await expect(mobilePage.getByRole("button", { name: "Comment on selection" })).toBeVisible();
    const priorCalls = calls;
    const openedLink = mobilePage.waitForEvent("popup");
    await mobilePage.locator('.prose a[href="#safety"]').tap();
    const linkedPage = await openedLink;
    await expect.poll(() => new URL(linkedPage.url()).hash).toBe("#safety");
    await linkedPage.close();
    expect(calls).toBe(priorCalls);
    await mobilePage.evaluate(() => window.scrollTo(0, 0));
    await mobilePage.evaluate(() => window.scrollTo(0, 400));
    await expect.poll(() => mobilePage.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    expect(calls).toBe(priorCalls);
  } finally {
    await mobileContext?.close();
  }
});

test("tap or double-click ranks a whole span, steps size, and opens the normal composer", async ({ page, request }, info) => {
  const key = `tap-select-${info.project.name}`;
  const content = "The small team carefully reviewed the release, then approved the focused staging experiment. Another sentence gives useful context.";
  await request.post("/api/content", { data: { key, content } });
  const modes: string[] = [];
  await page.route("**/api/tap-select", async route => {
    const body = route.request().postDataJSON();
    modes.push(body.mode);
    expect(body.context).toContain("reviewed");
    const chosen = body.candidates.findIndex((c: { kind: string }) => c.kind === "sentence");
    const ranking = [chosen, ...body.candidates.map((_: unknown, i: number) => i).filter((i: number) => i !== chosen)];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ranking, source: body.mode === "jev" ? "jev" : "heuristic", latency_ms: 42 }) });
  });
  const hydrated = page.waitForResponse(r => r.url().includes("/api/comments?status=all"));
  await page.goto(`/?key=${key}&persist=1&tap=jev`);
  await hydrated;
  await expect(page.getByRole("button", { name: "Comments (0 open)" })).toBeVisible();
  if (info.project.name !== "iphone-webkit") await page.clock.install();
  const point = await page.locator(".prose [data-source-start]").first().evaluate(element => {
    const text = element.firstChild!;
    const from = text.textContent!.indexOf("reviewed");
    const range = document.createRange();
    range.setStart(text, from + 3);
    range.setEnd(text, from + 4);
    const rect = range.getBoundingClientRect();
    return { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
  });
  const firstRanked = page.waitForResponse("**/api/tap-select");
  await selectByGesture(page, point, info.project.name);
  const bubble = page.getByRole("button", { name: "Comment on selection" });
  await expect(page.getByRole("status", { name: "Choosing quote" })).toBeVisible();
  await expect(bubble).toHaveCount(0);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("");
  await firstRanked;
  if (info.project.name !== "iphone-webkit") await page.clock.runFor(210);
  await expect(page.getByRole("status", { name: "Choosing quote" })).toHaveCount(0);
  await expect(bubble).toBeVisible();
  await expect(page.locator(".comment-auto-status")).toContainText(/jev · \d+ms/u);
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(content.split(". ")[0] + ".");
  if (info.project.name === "iphone-webkit") await page.getByRole("button", { name: "Smaller selection" }).tap();
  else await page.getByRole("button", { name: "Smaller selection" }).click();
  expect((await page.evaluate(() => window.getSelection()?.toString()))!.length).toBeLessThan(content.split(". ")[0].length);
  if (info.project.name === "iphone-webkit") await page.getByRole("button", { name: "Larger selection" }).tap();
  else await page.getByRole("button", { name: "Larger selection" }).click();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(content.split(". ")[0] + ".");
  await expect(bubble).toBeVisible();
  if (info.project.name === "iphone-webkit") await bubble.tap();
  else await bubble.click();
  await expect(page.getByLabel("Comment as You")).toBeFocused();
  await expect(page.locator(".comment-quote")).not.toBeEmpty();
  await page.getByLabel("Comment as You").fill("Synthetic tap feedback");
  await page.getByRole("button", { name: "Send comment", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  const snapshot = await (await request.get(`/api/comments?key=${key}`)).json();
  expect(snapshot.comments[0].anchor.exact).toContain("reviewed");
  expect(modes).toEqual(["jev"]);
  await page.getByRole("button", { name: "Heuristic" }).click();
  await expect(page.getByRole("button", { name: "Heuristic" })).toHaveAttribute("aria-pressed", "true");
  expect(new URL(page.url()).searchParams.get("tap")).toBe("heuristic");
  const second = await page.locator(".prose [data-source-start]").last().evaluate(element => {
    const node = element.firstChild!;
    const from = node.textContent!.indexOf("useful");
    const range = document.createRange();
    range.setStart(node, from + 2);
    range.setEnd(node, from + 3);
    const rect = range.getBoundingClientRect();
    return { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
  });
  const secondRanked = page.waitForResponse("**/api/tap-select");
  await selectByGesture(page, second, info.project.name);
  await secondRanked;
  if (info.project.name !== "iphone-webkit") await page.clock.runFor(210);
  await expect(page.locator(".comment-auto-status")).toContainText(/heuristic · \d+ms/u);
  expect(modes).toEqual(["jev", "heuristic"]);
  await page.getByRole("button", { name: "Wait up to 200 milliseconds" }).click();
  expect(new URL(page.url()).searchParams.get("tapwait")).toBe("200");
});

test("formatted word tap keeps raw Markdown offsets in the created anchor", async ({ page, request }, info) => {
  const key = `tap-format-${info.project.name}`;
  const content = "This **bold claim** deserves a comment. A [linked phrase](https://example.test) follows.";
  await request.post("/api/content", { data: { key, content } });
  await page.route("**/api/tap-select", async route => {
    const body = route.request().postDataJSON();
    const ranking = body.candidates.map((_: unknown, i: number) => i);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ranking, source: "jev", latency_ms: 11 }) });
  });
  const hydrated = page.waitForResponse(r => r.url().includes("/api/comments?status=all"));
  await page.goto(`/?key=${key}&persist=1`);
  await hydrated;
  if (info.project.name !== "iphone-webkit") await page.clock.install();
  const point = await page.locator(".prose strong [data-source-start]").first().evaluate(element => {
    const node = element.firstChild!;
    const range = document.createRange();
    range.setStart(node, 2);
    range.setEnd(node, 3);
    const rect = range.getBoundingClientRect();
    return { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
  });
  const ranked = page.waitForResponse("**/api/tap-select");
  await selectByGesture(page, point, info.project.name);
  await ranked;
  if (info.project.name !== "iphone-webkit") await page.clock.runFor(210);
  await expect(page.locator(".comment-auto-status")).toContainText(/jev · \d+ms/u);
  if (info.project.name === "iphone-webkit") await page.getByRole("button", { name: "Comment on selection" }).tap();
  else await page.getByRole("button", { name: "Comment on selection" }).click();
  await page.getByLabel("Comment as You").fill("Synthetic formatting feedback");
  await page.getByRole("button", { name: "Send comment", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  const snapshot = await (await request.get(`/api/comments?key=${key}`)).json();
  expect(snapshot.comments[0].anchor.exact).toBe("**bold claim**");
  expect(snapshot.comments[0].anchor.position).toEqual({ start: content.indexOf("**bold claim**"), end: content.indexOf("**bold claim**") + "**bold claim**".length });
});

test("a Jev reply after the short wait never replaces the displayed heuristic", async ({ page, request }, info) => {
  const key = `tap-late-${info.project.name}`;
  const content = "The small team carefully reviewed the release, then approved the focused staging experiment.";
  await request.post("/api/content", { data: { key, content } });
  let requestSeen = false, lateAttempted = false;
  await page.route("**/api/tap-select", async route => {
    requestSeen = true;
    const body = route.request().postDataJSON();
    const chosen = body.candidates.findIndex((c: { text: string }) => c.text === "reviewed the release");
    expect(chosen).toBeGreaterThanOrEqual(0);
    const ranking = [chosen, ...body.candidates.map((_: unknown, i: number) => i).filter((i: number) => i !== chosen)];
    await new Promise(resolve => setTimeout(resolve, 350));
    lateAttempted = true;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ranking, source: "jev", latency_ms: 330, timing: { route_ms: 330, typesafe_ms: 300, outcome: "jev" } }) });
  });
  const hydrated = page.waitForResponse(r => r.url().includes("/api/comments?status=all"));
  await page.goto(`/?key=${key}&persist=1&tapwait=200`);
  await hydrated;
  if (info.project.name !== "iphone-webkit") await page.clock.install();
  const point = await page.locator(".prose [data-source-start]").first().evaluate(element => {
    const node = element.firstChild!;
    const from = node.textContent!.indexOf("reviewed");
    const range = document.createRange();
    range.setStart(node, from + 3);
    range.setEnd(node, from + 4);
    const rect = range.getBoundingClientRect();
    return { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
  });
  await selectByGesture(page, point, info.project.name);
  await expect.poll(() => requestSeen).toBe(true);
  await expect(page.getByRole("status", { name: "Choosing quote" })).toBeVisible();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("");
  if (info.project.name !== "iphone-webkit") await page.clock.runFor(210);
  await expect(page.locator(".comment-auto-status")).toContainText(/heuristic · \d+ms/u);
  await expect(page.locator(".comment-auto-status")).toContainText("cap 200ms");
  const selected = await page.evaluate(() => window.getSelection()?.toString());
  expect(selected).toContain("carefully reviewed the release");
  expect(selected!.length).toBeLessThan(content.length / 2);
  if (info.project.name === "iphone-webkit") await page.getByRole("button", { name: "Larger selection" }).tap();
  else await page.getByRole("button", { name: "Larger selection" }).click();
  const larger = await page.evaluate(() => window.getSelection()?.toString());
  expect(larger!.length).toBeGreaterThan(selected!.length);
  if (info.project.name === "iphone-webkit") await page.getByRole("button", { name: "Smaller selection" }).tap();
  else await page.getByRole("button", { name: "Smaller selection" }).click();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(selected);
  await expect.poll(() => lateAttempted).toBe(true);
  await expect(page.locator(".comment-auto-status")).toContainText(/late Jev \d+ms · API 330ms · Jev 300ms/u);
  const statusBox = await page.locator(".comment-auto-status").boundingBox();
  expect(statusBox!.y + statusBox!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  if (info.project.name !== "iphone-webkit") await page.clock.runFor(300);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(selected);
  await expect(page.locator(".comment-auto-status")).toContainText(/heuristic · \d+ms/u);
});

test("the 700 ms setting uses a slower Jev answer as the one final selection", async ({ page, request }, info) => {
  const key = `tap-wait-${info.project.name}`;
  const content = "The small team carefully reviewed the release, then approved the focused staging experiment.";
  await request.post("/api/content", { data: { key, content } });
  await page.route("**/api/tap-select", async route => {
    const body = route.request().postDataJSON();
    const chosen = body.candidates.findIndex((candidate: { text: string }) => candidate.text === "reviewed the release");
    expect(chosen).toBeGreaterThanOrEqual(0);
    const ranking = [chosen, ...body.candidates.map((_: unknown, index: number) => index).filter((index: number) => index !== chosen)];
    await new Promise(resolve => setTimeout(resolve, 320));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ranking, source: "jev", timing: { route_ms: 300, typesafe_ms: 275, outcome: "jev" } }) });
  });
  const hydrated = page.waitForResponse(response => response.url().includes("/api/comments?status=all"));
  await page.goto(`/?key=${key}&persist=1&tapwait=700`);
  await hydrated;
  await expect(page.getByRole("button", { name: "Wait up to 700 milliseconds" })).toHaveAttribute("aria-pressed", "true");
  const point = await page.locator(".prose [data-source-start]").first().evaluate(element => {
    const node = element.firstChild!;
    const from = node.textContent!.indexOf("reviewed");
    const range = document.createRange();
    range.setStart(node, from + 3);
    range.setEnd(node, from + 4);
    const rect = range.getBoundingClientRect();
    return { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
  });
  await selectByGesture(page, point, info.project.name);
  await expect(page.getByRole("status", { name: "Choosing quote" })).toBeVisible();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("");
  await expect(page.locator(".comment-auto-status")).toContainText(/jev · \d+ms · API 300ms · Jev 275ms/u);
  const label = await page.locator(".comment-auto-status").textContent();
  const elapsed = Number(label?.match(/jev · (\d+)ms/u)?.[1]);
  expect(elapsed).toBeGreaterThan(200);
  expect(elapsed).toBeLessThan(700);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("reviewed the release");
});

test("the 700 ms cap keeps its focused fallback and reports a later server timeout", async ({ page, request }, info) => {
  const key = `tap-cap-${info.project.name}`;
  const content = "The small team carefully reviewed the release, then approved the focused staging experiment.";
  await request.post("/api/content", { data: { key, content } });
  await page.route("**/api/tap-select", async route => {
    const body = route.request().postDataJSON();
    const ranking = body.candidates.map((_: unknown, index: number) => index);
    await new Promise(resolve => setTimeout(resolve, 850));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ranking, source: "heuristic · timeout", timing: { route_ms: 800, typesafe_ms: 800, outcome: "timeout" } }) });
  });
  const hydrated = page.waitForResponse(response => response.url().includes("/api/comments?status=all"));
  await page.goto(`/?key=${key}&persist=1&tapwait=700`);
  await hydrated;
  const point = await page.locator(".prose [data-source-start]").first().evaluate(element => {
    const node = element.firstChild!;
    const from = node.textContent!.indexOf("reviewed");
    const range = document.createRange();
    range.setStart(node, from + 3);
    range.setEnd(node, from + 4);
    const rect = range.getBoundingClientRect();
    return { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
  });
  await selectByGesture(page, point, info.project.name);
  await expect(page.locator(".comment-auto-status")).toContainText(/heuristic · \d+ms · cap 700ms/u);
  const selected = await page.evaluate(() => window.getSelection()?.toString());
  expect(selected).toContain("reviewed");
  expect(selected!.length).toBeLessThan(content.length / 2);
  await expect(page.locator(".comment-auto-status")).toContainText(/late timeout \d+ms · API 800ms · Jev 800ms/u);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(selected);
});

test("a superseding tap aborts the old rank request without a late selection jump", async ({ page, request }, info) => {
  const key = `tap-abort-${info.project.name}`;
  const content = "The small team carefully reviewed the release, then approved the focused staging experiment.";
  await request.post("/api/content", { data: { key, content } });
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    const observed = window as typeof window & { tapAborts: number };
    observed.tapAborts = 0;
    window.fetch = ((input, init) => {
      if (typeof input === "string" && input.includes("/api/tap-select"))
        init?.signal?.addEventListener("abort", () => { observed.tapAborts++; });
      return original(input, init);
    }) as typeof fetch;
  });
  let calls = 0, firstAttempted = false;
  await page.route("**/api/tap-select", async route => {
    calls++;
    const body = route.request().postDataJSON();
    const chosen = body.candidates.findIndex((candidate: { text: string }) => candidate.text === "approved");
    const ranking = [chosen, ...body.candidates.map((_: unknown, index: number) => index).filter((index: number) => index !== chosen)];
    if (calls === 1) {
      await new Promise(resolve => setTimeout(resolve, 900));
      firstAttempted = true;
    }
    try { await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ranking, source: "jev", timing: { route_ms: 10, outcome: "jev" } }) }); }
    catch { /* The superseded request was aborted. */ }
  });
  const hydrated = page.waitForResponse(response => response.url().includes("/api/comments?status=all"));
  await page.goto(`/?key=${key}&persist=1&tapwait=700`);
  await hydrated;
  const points = await page.locator(".prose [data-source-start]").first().evaluate(element => {
    const node = element.firstChild!;
    return ["reviewed", "approved"].map(word => {
      const from = node.textContent!.indexOf(word);
      const range = document.createRange();
      range.setStart(node, from + 3);
      range.setEnd(node, from + 4);
      const rect = range.getBoundingClientRect();
      return { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
    });
  });
  await selectByGesture(page, points[0], info.project.name);
  await expect.poll(() => calls).toBe(1);
  await selectByGesture(page, points[1], info.project.name);
  await expect.poll(() => page.evaluate(() => (window as typeof window & { tapAborts: number }).tapAborts)).toBeGreaterThan(0);
  await expect(page.locator(".comment-auto-status")).toContainText(/jev · \d+ms/u);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("approved");
  await expect.poll(() => firstAttempted).toBe(true);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("approved");
});

test("a focused Jev phrase becomes the comment quote", async ({ page, request }, info) => {
  const key = `tap-phrase-${info.project.name}`;
  const content = "The small team carefully reviewed the release, then approved the focused staging experiment.";
  await request.post("/api/content", { data: { key, content } });
  await page.route("**/api/tap-select", async route => {
    const body = route.request().postDataJSON();
    const chosen = body.candidates.findIndex((c: { text: string }) => c.text === "reviewed the release");
    expect(chosen).toBeGreaterThanOrEqual(0);
    const ranking = [chosen, ...body.candidates.map((_: unknown, i: number) => i).filter((i: number) => i !== chosen)];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ranking, source: "jev", latency_ms: 60 }) });
  });
  const hydrated = page.waitForResponse(r => r.url().includes("/api/comments?status=all"));
  await page.goto(`/?key=${key}&persist=1`);
  await hydrated;
  const point = await page.locator(".prose [data-source-start]").first().evaluate(element => {
    const node = element.firstChild!;
    const from = node.textContent!.indexOf("reviewed");
    const range = document.createRange();
    range.setStart(node, from + 3);
    range.setEnd(node, from + 4);
    const rect = range.getBoundingClientRect();
    return { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
  });
  await selectByGesture(page, point, info.project.name);
  await expect(page.locator(".comment-auto-status")).toContainText(/jev · \d+ms/u);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("reviewed the release");
  const bubble = page.getByRole("button", { name: "Comment on selection" });
  if (info.project.name === "iphone-webkit") await bubble.tap();
  else await bubble.click();
  await expect(page.locator(".comment-quote")).toHaveText("reviewed the release");
  await page.getByLabel("Comment as You").fill("Synthetic focused comment");
  await page.getByRole("button", { name: "Send comment", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  const snapshot = await (await request.get(`/api/comments?key=${key}`)).json();
  expect(snapshot.comments[0].anchor.exact).toBe("reviewed the release");
});
