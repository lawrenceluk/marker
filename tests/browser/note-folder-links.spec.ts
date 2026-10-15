import { expect, test } from "@playwright/test";

test("note byline opens active and remembered folders, with deep-linked tags and no credential leakage", async ({ page, request, browser }, info) => {
  const stamp = `${info.project.name}-${Date.now()}`;
  const created = await request.post("/api/content", { data: {
    key: `folder-links-plan-${stamp}`, content: "# Synthetic navigation check\nA disposable note for checking folder links.",
    creator_id: true, creator_name: "Synthetic notes", tags: ["proposals", "personal-admin"],
  } });
  expect(created.ok()).toBeTruthy();
  const id = (await created.json()).creator_id as string;
  const key = `folder-links-plan-${stamp}`;
  await request.post("/api/content", { data: { key: `folder-links-other-${stamp}`, content: "# Other synthetic note", creator_id: id, tags: ["personal-admin"] } });
  const second = await (await request.post("/api/content", { data: { key: `folder-links-second-${stamp}`, content: "# Separate folder note", creator_id: true, creator_name: "Separate folder" } })).json();

  await page.goto(`/c?token=${id}`);
  await page.getByRole("link", { name: "Synthetic navigation check" }).click();
  const byline = page.getByLabel("Folder", { exact: true });
  const folder = byline.getByRole("link", { name: "Synthetic notes", exact: true });
  await expect(folder).toHaveAttribute("class", "byline-folder");
  await expect(byline.getByRole("link", { name: "proposals", exact: true })).toHaveAttribute("class", "tag tag-small");
  // A different tab switches the shared cookie after this byline has already rendered.
  const otherTab = await page.context().newPage();
  await otherTab.goto(`/c?token=${second.creator_id}`);
  await otherTab.close();
  await folder.click();
  await expect(page).toHaveURL(/\/c$/);
  await expect(page.getByRole("link", { name: "Other synthetic note" })).toBeVisible();
  await page.getByRole("link", { name: "Synthetic navigation check" }).click();
  await byline.getByRole("link", { name: "proposals", exact: true }).click();
  await expect(page).toHaveURL(/\/c\?tag=proposals$/);
  await expect(page.getByRole("button", { name: "proposals 1", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "personal-admin 2", exact: true })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("link", { name: "Other synthetic note" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "proposals 1", exact: true })).toHaveAttribute("aria-pressed", "true");

  // A second active folder must not turn the first folder's byline into dead text.
  await page.goto(`/c?token=${second.creator_id}`);
  await page.goto(`/?key=${key}&persist=1`);
  await expect(folder).toHaveAttribute("href", /^\/c\/folder\/[A-Za-z0-9_-]+$/);
  const html = await page.content();
  expect(html).not.toContain(id);
  expect(html).not.toContain(second.creator_id);
  const meta = await (await page.request.get("/api/content")).json();
  expect(meta.creator_linked).toBe(false);
  expect(meta.creator_folder_href).toBe(await folder.getAttribute("href"));
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", await page.locator("body").evaluate(el => el.clientWidth));
  await page.screenshot({ path: `test-results/note-folder-links-after-${info.project.name}.png`, fullPage: true });
  // Reuse the design system's existing hover and keyboard focus treatments.
  await folder.hover();
  await expect(folder).toHaveCSS("text-decoration-thickness", "2px");
  await page.keyboard.press("Tab");
  const tag = byline.getByRole("link", { name: "personal-admin", exact: true });
  await tag.focus();
  await expect(tag).toHaveCSS("outline-width", "2px");
  await folder.click();
  await expect(page).toHaveURL(/\/c$/);
  await expect(page.getByRole("heading", { name: "Synthetic notes", exact: true })).toBeVisible();

  // The tag must survive the remembered-folder activation redirect as a single-tag filter.
  await page.goto(`/c?token=${second.creator_id}`);
  await page.goto(`/?key=${key}`);
  await byline.getByRole("link", { name: "proposals", exact: true }).click();
  await expect(page).toHaveURL(/\/c\?tag=proposals$/);
  await expect(page.getByRole("heading", { name: "Synthetic notes", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "proposals 1", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("link", { name: "Other synthetic note" })).toHaveCount(0);
  await page.screenshot({ path: `test-results/note-folder-filter-after-${info.project.name}.png`, fullPage: true });

  // A fresh note-only browser gets links, but no listing or edit authority.
  const stranger = await browser.newContext({ ...info.project.use, ignoreHTTPSErrors: true });
  try {
    const other = await stranger.newPage();
    const openNote = () => other.goto(`/?key=${key}&persist=1`);
    const isolatedByline = other.getByLabel("Folder", { exact: true });
    await openNote();
    await expect(isolatedByline.getByRole("link")).toHaveCount(3);
    const isolatedHtml = await other.content();
    expect(isolatedHtml).not.toContain(id);
    expect(isolatedHtml).not.toContain(second.creator_id);
    const noteOnlyMeta = await (await other.request.get("/api/content")).json();
    expect(noteOnlyMeta.creator_linked).toBe(false);
    expect(noteOnlyMeta.creator_folder_href).toBe(meta.creator_folder_href);
    await other.getByRole("button", { name: "More" }).click();
    await expect(other.getByRole("button", { name: "Edit tags" })).toHaveCount(0);
    await other.getByRole("button", { name: "More" }).click();
    await other.screenshot({ path: `test-results/note-fresh-header-${info.project.name}.png`, fullPage: true });
    await isolatedByline.getByRole("link", { name: "Synthetic notes", exact: true }).click();
    await expect(other.getByLabel("Creator id")).toBeVisible();
    await expect(other.getByRole("heading", { name: "Synthetic notes", exact: true })).toHaveCount(0);
    // Even a different active folder cannot hijack this note's destination.
    await other.goto(`/c?token=${second.creator_id}`);
    await openNote();
    await isolatedByline.getByRole("link", { name: "proposals", exact: true }).click();
    await expect(other).toHaveURL(/\/c\?folder=[A-Za-z0-9_-]+&tag=proposals$/);
    await expect(other.getByLabel("Creator id")).toBeVisible();
    await expect(other.getByRole("heading", { name: "Separate folder", exact: true })).toHaveCount(0);
    await other.getByLabel("Creator id").fill(second.creator_id);
    await other.getByRole("button", { name: "Open", exact: true }).click();
    await expect(other.getByRole("alert").filter({ hasText: "That id belongs to a different folder." })).toBeVisible();
    await expect(other).toHaveURL(/tag=proposals&error=wrong_folder$/);
    await other.getByLabel("Creator id").fill(id);
    await other.getByRole("button", { name: "Open", exact: true }).click();
    await expect(other).toHaveURL(/\/c\?tag=proposals$/);
    await expect(other.getByRole("heading", { name: "Synthetic notes", exact: true })).toBeVisible();
    await expect(other.getByRole("button", { name: "proposals 1", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(other.getByRole("link", { name: "Other synthetic note" })).toHaveCount(0);
    await other.reload();
    await expect(other.getByRole("button", { name: "proposals 1", exact: true })).toHaveAttribute("aria-pressed", "true");
    await openNote();
    await isolatedByline.getByRole("link", { name: "Synthetic notes", exact: true }).click();
    await expect(other.getByRole("link", { name: "Other synthetic note" })).toBeVisible();
  } finally {
    await stranger.close();
  }
});
