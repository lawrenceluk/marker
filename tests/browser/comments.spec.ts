import { test, expect, type Locator } from "@playwright/test";

async function activate(locator: Locator, touch: boolean) {
  if (touch) await locator.tap();
  else await locator.click();
}

test("select → icon → type → send, then agent edit/resolve and focused replies", async ({
  page,
  request,
}, info) => {
  const touch = info.project.name === "iphone-webkit";
  const key = `selection-${info.project.name}`;
  const content =
    "# Synthetic plan\n\nTry **a little text** and more.\n\nAnother paragraph.";
  await request.post("/api/content", { data: { key, content } });
  await page.goto(`/?key=${key}&persist=1`);
  await expect(
    page.getByRole("button", { name: "Comment on this note" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Comments (0 open)", exact: true }),
  ).toBeVisible();
  // Real DOM Selection across rendered formatting; touch handles themselves need an actual iPhone.
  await page.locator(".prose").evaluate((root) => {
    const start = [...root.querySelectorAll("[data-source-start]")].find(
      (n) => n.textContent === "Try ",
    )!;
    const end = [...root.querySelectorAll("[data-source-start]")].find(
      (n) => n.textContent === "a little text",
    )!;
    const range = document.createRange();
    range.setStart(start.firstChild!, 0);
    range.setEnd(end.firstChild!, 13);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
  });
  const icon = page.getByRole("button", { name: "Comment on selection" });
  await expect(icon).toBeVisible();
  const bounds = await icon.boundingBox();
  const selected = await page.evaluate(() =>
    Array.from(window.getSelection()!.getRangeAt(0).getClientRects())
      .sort((a, b) => b.bottom - a.bottom || b.right - a.right)[0]
      .toJSON(),
  );
  expect(bounds!.width).toBe(touch ? 28 : 24);
  expect(bounds!.x - selected.right).toBeCloseTo(touch ? 14 : 4, 1);
  expect(
    Math.abs(
      bounds!.y + bounds!.height / 2 - (selected.top + selected.bottom) / 2,
    ),
  ).toBeLessThan(1);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
  await page.screenshot({
    animations: "disabled",
    path: `test-results/selection-${info.project.name}.png`,
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({
    animations: "disabled",
    path: `test-results/selection-dark-${info.project.name}.png`,
  });
  await page.emulateMedia({ colorScheme: "light" });
  // A visible extension control occupying the preferred spot should get a fallback.
  await page.evaluate(({ x, y, width, height }) => {
    const control = document.createElement("button");
    control.id = "synthetic-extension-control";
    Object.assign(control.style, {
      position: "fixed",
      zIndex: "999",
      left: `${x}px`,
      top: `${y}px`,
      width: `${width}px`,
      height: `${height}px`,
    });
    document.body.append(control);
    document.dispatchEvent(new Event("selectionchange"));
  }, bounds!);
  await expect
    .poll(async () => {
      const moved = await icon.boundingBox();
      return (
        moved &&
        (moved.x + moved.width <= bounds!.x ||
          moved.x >= bounds!.x + bounds!.width ||
          moved.y >= bounds!.y + bounds!.height)
      );
    })
    .toBeTruthy();
  await page.evaluate(() => {
    document.getElementById("synthetic-extension-control")!.remove();
    document.dispatchEvent(new Event("selectionchange"));
  });
  await expect
    .poll(async () => Math.abs((await icon.boundingBox())!.x - bounds!.x))
    .toBeLessThan(1);
  await activate(icon, touch);
  await expect(page.getByLabel("Comment as You")).toBeFocused();
  await expect(page.locator(".comment-quote")).toHaveText("Try a little text");
  await page.keyboard.type("Make this clearer."); // No extra click/fill to focus the input.
  await page.screenshot({
    animations: "disabled",
    path: `test-results/composer-${info.project.name}.png`,
  });
  if (touch)
    await activate(
      page.getByRole("button", { name: "Send comment", exact: true }),
      true,
    );
  else await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Comments (1 open)", exact: true }),
  ).toBeVisible();
  const snapshot = await (await request.get(`/api/comments?key=${key}`)).json();
  expect(snapshot.comments[0].anchor.exact).toBe("Try **a little text");
  expect(snapshot.comments[0].messages[0]).toMatchObject({
    author: "You",
    text: "Make this clearer.",
  });
  const id = snapshot.comments[0].id;
  const result = await request.post("/api/comments", {
    data: {
      key,
      if_rev: snapshot.rev,
      content: content.replace(
        "Try **a little text**",
        "Try selecting a sentence",
      ),
      operations: [
        { action: "reply", id, text: "Clarified the instructions." },
        { action: "resolve", id },
      ],
    },
  });
  expect(result.status()).toBe(200);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await activate(page.getByRole("button", { name: "Updated · tap to refresh" }), touch);
  await activate(page.getByRole("button", { name: /^Comments \(/ }), touch);
  await page.getByLabel("Include resolved").check();
  await activate(
    page.getByRole("button", { name: /Resolved · Outdated/ }),
    touch,
  );
  const reply = page.getByLabel("Reply as You");
  await expect(reply).toBeFocused();
  await expect(page.locator(".comment-quote")).toHaveText("Try a little text");
  await expect(page.getByText("Agent", { exact: true })).toBeVisible();
  await page.keyboard.type("Thanks");
  // Mobile Return and desktop Shift+Enter make newlines; desktop Cmd+Enter sends.
  await page.keyboard.press(touch ? "Enter" : "Shift+Enter");
  await expect(reply).toHaveValue("Thanks\n");
  await page.keyboard.type("Looks good.");
  if (touch)
    await activate(page.getByRole("button", { name: "Send reply" }), true);
  else await page.keyboard.press("Meta+Enter");
  await expect(
    page.getByText("Thanks\nLooks good.", { exact: true }),
  ).toBeVisible();
  await activate(
    page.getByRole("button", { name: "Reopen", exact: true }),
    touch,
  );
  await expect(
    page.getByRole("button", { name: "Resolve", exact: true }),
  ).toBeVisible();
  await activate(
    page.getByRole("button", { name: "Resolve", exact: true }),
    touch,
  );
  await expect(
    page.getByRole("button", { name: "Reopen", exact: true }),
  ).toBeVisible();
});

test("automatic highlights, compact focused thread, dark mode and no comments in initial HTML", async ({
  page,
  request,
}, info) => {
  const touch = info.project.name === "iphone-webkit";
  const url = "/?key=commenting-demo-v1&persist=1";
  await page.goto(url);
  const response = await request.get(url);
  expect(await response.text()).not.toContain(
    "Should we start with three people instead?",
  );
  await expect(
    page.getByRole("button", { name: /^Comments \(/ }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(page.viewportSize()!.width);
  await activate(
    page.locator("mark").filter({ hasText: "Invite five people" }),
    touch,
  );
  await expect(page.getByLabel("Reply as You")).toBeFocused();
  await page.keyboard.type("Browser test reply");
  await activate(page.getByRole("button", { name: "Send reply" }), touch);
  await expect(page.getByLabel("Reply as You")).toHaveValue("");
  await expect(
    page.getByText("Browser test reply", { exact: true }).last(),
  ).toBeVisible();
  await page.screenshot({
    animations: "disabled",
    path: `test-results/thread-${info.project.name}.png`,
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({
    animations: "disabled",
    path: `test-results/thread-dark-${info.project.name}.png`,
  });
  const before = await (
    await request.get("/api/comments?key=commenting-demo-v1&status=all")
  ).json();
  await page.reload();
  const after = await (
    await request.get("/api/comments?key=commenting-demo-v1&status=all")
  ).json();
  expect(after).toEqual(before);
});

test("raw editor remaps the third repeated phrase and retains its thread", async ({
  page,
  request,
}, info) => {
  const key = `editor-map-${info.project.name}`;
  const content =
    "First: same phrase\n\nSecond: same phrase\n\nThird: same phrase\n\nFourth: same phrase";
  await request.post("/api/content", { data: { key, content } });
  const start = content.indexOf("same phrase", content.indexOf("Third:"));
  await request.post("/api/comments", {
    data: {
      key,
      if_rev: 1,
      operations: [
        {
          action: "create",
          start,
          end: start + 11,
          text: "Third occurrence only",
        },
      ],
    },
  });
  await page.goto(`/?key=${key}&persist=1`);
  await expect(page.locator("mark")).toHaveCount(1);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const revised =
    "# Intro\n\n" +
    content.replace("Second:", "Revised second:") +
    "\n\nEnding";
  await page
    .getByPlaceholder("Enter your markdown content here...")
    .fill(revised);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("mark")).toHaveCount(1);
  await expect(page.locator("mark").locator("..")).toHaveText(
    "Third: same phrase",
  );
  const state = await (await request.get(`/api/comments?key=${key}`)).json();
  expect(state.comments[0].location.start).toBe(
    revised.indexOf("same phrase", revised.indexOf("Third:")),
  );
  expect(state.comments[0].anchor.position.start).toBe(
    state.comments[0].location.start,
  );
});
