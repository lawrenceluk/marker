import { expect, test } from "@playwright/test";

test("creator folder: token link, AND tag filter, open a row, edit tags in the note", async ({ page, request, browser }, info) => {
  const stamp = `${info.project.name}-${Date.now()}`;
  const creatorId = `browser_creator_${stamp}`.replace(/[^A-Za-z0-9_~-]/g, "-").padEnd(24, "x");
  const keys = { plan: `creator-plan-${stamp}`, notes: `creator-notes-${stamp}` };
  await request.post("/api/content", { data: { key: keys.plan, content: "# Q4 plan\nShip it.", creator_id: creatorId, creator_name: "Lawrence's plans", tags: ["plans", "q4"] } });
  await request.post("/api/content", { data: { key: keys.notes, content: "# Meeting notes\nAgenda.", creator_id: creatorId, tags: ["q4"] } });

  await page.goto(`/c?token=${creatorId}`);
  await expect(page).toHaveURL(/\/c$/);
  await expect(page.getByRole("heading", { name: "Lawrence's plans" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Meeting notes" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Q4 plan" })).toBeVisible();
  const html = await page.content();
  expect(html).not.toContain(creatorId);
  expect(html).not.toContain(keys.plan);
  await page.screenshot({ path: `test-results/creator-folder-${info.project.name}.png`, fullPage: true });

  await page.getByRole("button", { name: /^plans 1$/ }).click();
  await expect(page).toHaveURL(/\/c\?tag=plans$/);
  await expect(page.getByRole("link", { name: "Meeting notes" })).toHaveCount(0);
  await expect(page.getByText("1 note tagged plans")).toBeVisible();
  await page.screenshot({ path: `test-results/creator-folder-filtered-${info.project.name}.png`, fullPage: true });

  await page.getByRole("link", { name: "Q4 plan" }).click();
  await expect(page).toHaveURL(/\/n$/);
  await expect(page.getByRole("heading", { name: "Q4 plan" })).toBeVisible();
  const folder = page.getByLabel("Folder");
  await expect(folder.getByRole("link", { name: "Lawrence's plans" })).toHaveAttribute("href", "/c");
  await expect(folder.getByRole("link", { name: "q4" })).toBeVisible();

  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("button", { name: "Edit tags" }).click();
  await page.getByLabel("Tags").fill("plans, Done");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(folder.getByRole("link", { name: "done" })).toBeVisible();
  await expect(folder.getByRole("link", { name: "q4" })).toHaveCount(0);
  await page.screenshot({ path: `test-results/creator-note-${info.project.name}.png`, fullPage: true });
  const stored = await (await request.get(`/api/content?key=${keys.plan}`)).json();
  expect(stored.tags).toEqual(["done", "plans"]);
  expect(stored.rev).toBe(1);

  // A browser without the folder cookie sees the note's pills but no folder link or tag editing.
  const stranger = await browser.newContext({ ignoreHTTPSErrors: true });
  const other = await stranger.newPage();
  await other.goto(`/?key=${keys.plan}`);
  await expect(other.getByLabel("Folder").getByText("Lawrence's plans")).toBeVisible();
  await expect(other.getByLabel("Folder").getByRole("link")).toHaveCount(0);
  await other.getByRole("button", { name: "More" }).click();
  await expect(other.getByRole("button", { name: "Edit tags" })).toHaveCount(0);

  // Pasting the id on /c opens the folder; a wrong id is refused.
  await other.goto("/c");
  await other.getByLabel("Creator id").fill("not-the-right-creator-id-000");
  await other.getByRole("button", { name: "Open" }).click();
  await expect(other.getByText("No folder exists for that creator id.")).toBeVisible();
  await other.getByLabel("Creator id").fill(creatorId);
  await other.getByRole("button", { name: "Open" }).click();
  await expect(other.getByRole("heading", { name: "Lawrence's plans" })).toBeVisible();
  await other.getByRole("button", { name: "More" }).click();
  await other.getByRole("button", { name: "Forget this folder" }).click();
  await expect(other.getByLabel("Creator id")).toBeVisible();
  await stranger.close();
});
