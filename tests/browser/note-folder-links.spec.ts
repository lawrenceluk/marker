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

  // Without the matching active or remembered credential, only plain text is rendered.
  const stranger = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    const other = await stranger.newPage();
    await other.goto(`/?key=${key}&persist=1`);
    await expect(other.getByLabel("Folder", { exact: true }).getByText("Synthetic notes", { exact: true })).toBeVisible();
    await expect(other.getByLabel("Folder", { exact: true }).getByRole("link")).toHaveCount(0);
    const isolatedHtml = await other.content();
    expect(isolatedHtml).not.toContain(id);
    expect(isolatedHtml).not.toContain(meta.creator_folder_href);
    await other.goto(`/c?token=${second.creator_id}`);
    await other.goto(`/?key=${key}`);
    await expect(other.getByLabel("Folder", { exact: true }).getByRole("link")).toHaveCount(0);
  } finally {
    await stranger.close();
  }
});
