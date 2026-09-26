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
    window.getSelection()!.getRangeAt(0).getBoundingClientRect().toJSON(),
  );
  expect(bounds!.y).toBeGreaterThan(selected.bottom);
  expect(bounds!.y - selected.bottom).toBeLessThan(50);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
  await page.screenshot({
    animations: "disabled",
    path: `test-results/selection-${info.project.name}.png`,
  });
  await activate(icon, touch);
  await expect(page.getByLabel("Comment as You")).toBeFocused();
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
  await activate(page.getByRole("button", { name: /^Comments \(/ }), touch);
  await page.getByLabel("Include resolved").check();
  await activate(
    page.getByRole("button", { name: /Resolved · Outdated/ }),
    touch,
  );
  const reply = page.getByLabel("Reply as You");
  await expect(reply).toBeFocused();
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
