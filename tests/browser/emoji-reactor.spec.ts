import { expect, test } from "@playwright/test";

test("selection separates compact emoji reactions from the written comment composer", async ({ page, request }, info) => {
  let key = `emoji-reactor-picker-${Date.now()}`;
  const content = "The tiny dinosaur won the design review. Everyone cheered.";
  await request.post("/api/content", { data: { key, content } });
  await page.goto(`/?key=${key}&persist=1`);
  await expect(page.getByRole("button", { name: "Comments (0 open)" })).toBeVisible();
  const select = async (start: number, end: number) => {
    await page.locator(".prose [data-source-start]").filter({ hasText: content }).evaluate((element, offsets) => {
      window.getSelection()!.setBaseAndExtent(element.firstChild!, offsets.start, element.firstChild!, offsets.end);
      document.dispatchEvent(new Event("selectionchange"));
    }, { start, end });
    await expect(page.getByRole("button", { name: "Comment on selection" })).toBeVisible();
    await expect(page.getByRole("button", { name: "React to selection" })).toBeVisible();
  };
  await select(9, 17);
  await page.getByRole("button", { name: "React to selection" }).click();
  await expect(page.getByRole("toolbar", { name: "Emoji reactions" })).toBeVisible();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect((await page.getByRole("button", { name: "React to selection" }).boundingBox())!.width).toBe(info.project.name === "iphone-webkit" ? 36 : 32);
  expect((await page.getByRole("button", { name: "Search emoji" }).boundingBox())!.width).toBe(46);
  await page.screenshot({ path: `test-results/emoji-reactor-inline-${test.info().project.name}.png` });
  await expect(page.getByRole("button", { name: /^React with / })).toHaveCount(3);
  await page.getByRole("button", { name: "Search emoji" }).click();
  await page.evaluate(() => {
    window.visualViewport?.dispatchEvent(new Event("resize"));
    window.dispatchEvent(new Event("scroll"));
  });
  await expect(page.getByPlaceholder("Search")).toBeVisible();
  await page.getByPlaceholder("Search").fill("dinosaur");
  await expect(page.getByRole("button", { name: /brachiosaurus|tyrannosaurus/i }).first()).toBeVisible();
  await page.getByRole("button", { name: /brachiosaurus|tyrannosaurus/i }).first().click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  let snapshot = await (await request.get(`/api/comments?key=${key}`)).json();
  expect(snapshot.comments[0].messages[0].text).toMatch(/[🦕🦖]/u);
  expect(snapshot.comments[0].anchor.exact).toBe("dinosaur");

  key = `emoji-reactor-quick-${Date.now()}`;
  await request.post("/api/content", { data: { key, content } });
  await page.goto(`/?key=${key}&persist=1`);
  await expect(page.getByRole("button", { name: "Comments (0 open)" })).toBeVisible();
  await select(50, 57);
  await page.getByRole("button", { name: "React to selection" }).click();
  await page.getByRole("button", { name: "React with 👍" }).click();
  await expect(page.getByRole("toolbar", { name: "Emoji reactions" })).not.toBeVisible();
  snapshot = await (await request.get(`/api/comments?key=${key}`)).json();
  expect(snapshot.comments.some((comment: { messages: { text: string }[] }) => comment.messages[0].text === "👍")).toBe(true);
  expect(snapshot.comments[0].anchor.exact).toBe("cheered");

  key = `emoji-reactor-text-${Date.now()}`;
  await request.post("/api/content", { data: { key, content } });
  await page.goto(`/?key=${key}&persist=1`);
  await expect(page.getByRole("button", { name: "Comments (0 open)" })).toBeVisible();
  await select(0, 8);
  await page.getByRole("button", { name: "React to selection" }).click();
  await expect(page.getByRole("toolbar", { name: "Emoji reactions" })).toBeVisible();
  await page.getByRole("button", { name: "Comment on selection" }).click();
  await expect(page.getByRole("toolbar", { name: "Emoji reactions" })).not.toBeVisible();
  await expect(page.getByLabel("Comment as You")).toBeFocused();
  await page.getByLabel("Comment as You").fill("A written note still works.");
  await page.getByRole("button", { name: "Send comment" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  snapshot = await (await request.get(`/api/comments?key=${key}`)).json();
  expect(snapshot.comments.some((comment: { messages: { text: string }[] }) => comment.messages[0].text === "A written note still works.")).toBe(true);
});
