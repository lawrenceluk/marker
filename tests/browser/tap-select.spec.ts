import { test, expect } from "@playwright/test";

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
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ranking, source: "jev", latency_ms: 42 }) });
  });
  await page.goto(`/?key=${key}&persist=1&tap=jev`);
  await expect(page.getByRole("button", { name: "Comments (0 open)" })).toBeVisible();
  const point = await page.locator(".prose [data-source-start]").first().evaluate(element => {
    const text = element.firstChild!;
    const from = text.textContent!.indexOf("reviewed");
    const range = document.createRange();
    range.setStart(text, from + 3);
    range.setEnd(text, from + 4);
    const rect = range.getBoundingClientRect();
    return { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
  });
  if (info.project.name === "iphone-webkit") await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.dblclick(point.x, point.y);
  const bubble = page.getByRole("button", { name: "Comment on selection" });
  await expect(bubble).toBeVisible();
  await expect(page.locator(".comment-auto-status")).toContainText("jev · 42ms");
  await page.screenshot({ path: `test-results/tap-select-${info.project.name}.png` });
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(content.split(". ")[0] + ".");
  await page.getByRole("button", { name: "Smaller selection" }).click();
  expect((await page.evaluate(() => window.getSelection()?.toString()))!.length).toBeLessThan(content.split(". ")[0].length);
  await page.getByRole("button", { name: "Larger selection" }).click();
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
  if (info.project.name === "iphone-webkit") await page.touchscreen.tap(second.x, second.y);
  else await page.mouse.dblclick(second.x, second.y);
  await expect(page.locator(".comment-auto-status")).toContainText("jev · 42ms");
  expect(modes).toEqual(["jev", "heuristic"]);
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
  await page.goto(`/?key=${key}&persist=1`);
  const point = await page.locator(".prose strong [data-source-start]").first().evaluate(element => {
    const node = element.firstChild!;
    const range = document.createRange();
    range.setStart(node, 2);
    range.setEnd(node, 3);
    const rect = range.getBoundingClientRect();
    return { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
  });
  if (info.project.name === "iphone-webkit") await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.dblclick(point.x, point.y);
  await expect(page.locator(".comment-auto-status")).toContainText("jev · 11ms");
  await page.getByRole("button", { name: "Comment on selection" }).click();
  await page.getByLabel("Comment as You").fill("Synthetic formatting feedback");
  await page.getByRole("button", { name: "Send comment", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  const snapshot = await (await request.get(`/api/comments?key=${key}`)).json();
  expect(snapshot.comments[0].anchor.exact).toBe("**bold claim**");
  expect(snapshot.comments[0].anchor.position).toEqual({ start: content.indexOf("**bold claim**"), end: content.indexOf("**bold claim**") + "**bold claim**".length });
});
