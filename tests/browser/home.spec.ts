import { expect, test } from "@playwright/test";

const home = (page: import("@playwright/test").Page) => page.getByRole("heading", { name: "Marker", exact: true });

test("/ always opens on Home; one-off links, reloads and new notes live at /n", async ({ page, request }, info) => {
  const key = `home-${info.project.name}-${Date.now()}`;
  await request.post("/api/content", { data: { key, content: "# Session note\nHello." } });

  await page.goto(`/?key=${key}`);
  await expect(page).toHaveURL(/\/n\/[A-Za-z0-9_-]+$/);
  await expect(page.getByRole("heading", { name: "Session note" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Session note" })).toBeVisible();

  // The session cookie is still set, but `/` ignores it.
  await page.goto("/");
  await expect(home(page)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Session note" })).toHaveCount(0);

  // Persistent links still open their note at `/`.
  await page.goto(`/?key=${key}&persist=1`);
  await expect(page.getByRole("heading", { name: "Session note" })).toBeVisible();
  await page.goto("/");
  await expect(home(page)).toBeVisible();

  // New random note: unused key, editor, saved, survives reload, and `/` is Home again.
  await page.getByRole("button", { name: "New random note" }).click();
  await expect(page.getByPlaceholder("Write markdown…")).toBeVisible();
  await expect(page).toHaveURL(/\/n\/[A-Za-z0-9_-]+$/);
  await page.getByPlaceholder("Write markdown…").fill("# Fresh note");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: "Fresh note" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Fresh note" })).toBeVisible();
  await page.goBack();
  await expect(home(page)).toBeVisible();

  // Typing a key opens it at /n; Home returns to `/`.
  await page.getByLabel("Secret key").fill(key);
  await page.getByRole("button", { name: "Open note" }).click();
  await expect(page.getByRole("heading", { name: "Session note" })).toBeVisible();
  await expect(page).toHaveURL(/\/n\/[A-Za-z0-9_-]+$/);
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(home(page)).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test("Home lists remembered folders newest first, reopens them by ref, and forgets one", async ({ page, request }, info) => {
  const stamp = `${info.project.name}-${Date.now()}`.replace(/[^A-Za-z0-9_~-]/g, "-");
  const ids = { work: `home_work_${stamp}`.padEnd(24, "x"), trips: `home_trips_${stamp}`.padEnd(24, "x") };
  await request.post("/api/content", { data: { key: `w1-${stamp}`, content: "# W1", creator_id: ids.work, creator_name: "Work notes" } });
  await request.post("/api/content", { data: { key: `w2-${stamp}`, content: "# W2", creator_id: ids.work } });
  await request.post("/api/content", { data: { key: `t1-${stamp}`, content: "# T1", creator_id: ids.trips, creator_name: "Trips" } });

  await page.goto(`/c?token=${ids.work}`);
  await expect(page.getByRole("heading", { name: "Work notes" })).toBeVisible();
  await page.goto(`/c?token=${ids.trips}`);
  await expect(page.getByRole("heading", { name: "Trips" })).toBeVisible();

  await page.goto("/");
  const section = page.getByRole("region", { name: "Folders" });
  await expect(section.getByRole("link")).toHaveText([/Trips\s*1 note/, /Work notes\s*2 notes/]);
  const html = await page.content();
  expect(html).not.toContain(ids.work);
  expect(html).not.toContain(ids.trips);
  await page.screenshot({ path: `test-results/home-folders-${info.project.name}.png`, fullPage: true });

  await section.getByRole("link", { name: /Work notes/ }).click();
  await expect(page).toHaveURL(/\/c$/);
  await expect(page.getByRole("heading", { name: "Work notes" })).toBeVisible();
  await page.goto("/");
  await expect(section.getByRole("link")).toHaveText([/Work notes/, /Trips/]);

  await expect(section.getByRole("button", { name: "Forget folder" })).toHaveCount(0);
  await section.getByRole("button", { name: "More options for Trips" }).click();
  await page.screenshot({ path: `test-results/home-folder-menu-${info.project.name}.png` });
  await section.getByRole("button", { name: "Forget folder" }).click();
  await expect(home(page)).toBeVisible();
  await expect(section.getByRole("link")).toHaveText([/Work notes/]);
});
