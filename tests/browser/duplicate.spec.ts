import { expect, test } from "@playwright/test";

test("duplicate note: menu, processing toast, redirect, arrival toast with Change key", async ({ page, request }) => {
  const key = `dup-browser-${Date.now()}`;
  await request.post("/api/content", { data: { key, content: "# Original\n\nKeep this line.", if_rev: 0 } });
  await page.goto(`/?key=${key}`);
  await expect(page.getByRole("heading", { name: "Original" })).toBeVisible();

  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("button", { name: "Duplicate note" }).click();
  await expect(page.getByRole("status")).toContainText("Duplicating");

  await expect(page.getByRole("heading", { name: "[COPY] Original" })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("status")).toContainText("Viewing duplicate");
  await page.getByRole("button", { name: "Change key", exact: true }).click();
  await expect(page.getByLabel("New secret key")).toBeVisible();
});
