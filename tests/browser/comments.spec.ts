import { test, expect } from "@playwright/test";

test("rendered selection across bold text creates a source anchor; agent edits and resolves it", async ({
  page,
  request,
}, info) => {
  const key = `selection-${info.project.name}`;
  const content =
    "# Synthetic plan\n\nTry **a little text** and more.\n\nAnother paragraph.";
  await request.post("/api/content", { data: { key, content } });
  await page.goto(`/?key=${key}&persist=1`);
  await page.getByRole("button", { name: "Comment on this note" }).click();
  await expect(
    page.getByRole("button", { name: "Exit commenting" }),
  ).toBeVisible();
  // Exercise the browser Selection API, actual rendered DOM source map, selectionchange and sheet.
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
  await page.getByRole("button", { name: "Comment on selection" }).click();
  await page.getByLabel("Comment as You").fill("Make this clearer.");
  await page.getByRole("button", { name: "Post comment", exact: true }).click();
  await expect(
    page.getByText("Make this clearer.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("You", { exact: true })).toBeVisible();
  const snapshot = await (await request.get(`/api/comments?key=${key}`)).json();
  expect(snapshot.comments[0].anchor.exact).toBe("Try **a little text");
  expect(snapshot.comments[0].location.state).toBe("attached");
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
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: /^Threads/ }).click();
  await page.getByLabel("Include resolved").check();
  await page.getByRole("button", { name: /Resolved · Outdated/ }).click();
  await expect(page.getByText("Agent", { exact: true })).toBeVisible();
  await expect(page.getByText("Clarified the instructions.")).toBeVisible();
  await page.getByRole("button", { name: "Reopen", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Resolve", exact: true }),
  ).toBeVisible();
});

test("Preview demo seeds once, highlights work, threads stay out of initial HTML and metadata", async ({
  page,
  request,
}) => {
  const url = "/?key=commenting-demo-v1&persist=1";
  await page.goto(url);
  await expect(
    page.getByText("Preview sandbox", { exact: false }),
  ).toBeVisible();
  const response = await request.get(url);
  expect(await response.text()).not.toContain(
    "Should we start with three people instead?",
  );
  await page.getByRole("button", { name: "Comment on this note" }).click();
  await page.locator("mark").filter({ hasText: "Invite five people" }).click();
  await expect(
    page.getByText("Should we start with three people instead?"),
  ).toBeVisible();
  await page.getByLabel("Reply as You").fill("Browser test reply");
  await page.getByRole("button", { name: "Post reply" }).click();
  await expect(
    page.getByText("Browser test reply", { exact: true }).last(),
  ).toBeVisible();
  await page.screenshot({
    path: `test-results/demo-${test.info().project.name}.png`,
    fullPage: true,
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
