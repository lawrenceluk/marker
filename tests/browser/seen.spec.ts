import { expect, test } from "@playwright/test";

test("an agent's change shows as new until a person opens the note", async ({ page, request }, info) => {
  const stamp = `${info.project.name}-${Date.now()}`;
  // An agent (explicit key) writes two notes into a folder.
  const created = await (await request.post("/api/content", { data: { key: `seen-a-${stamp}`, content: "# Agent run", creator_id: true, creator_name: "Agent runs" } })).json();
  await request.post("/api/content", { data: { key: `seen-b-${stamp}`, content: "# Second run", creator_id: created.creator_id } });

  await page.goto(`/c?token=${created.creator_id}`);
  const rows = page.locator(".list-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.locator(".list-dot")).toHaveCount(2);
  await expect(page.getByRole("link", { name: /Agent run \(new\)/ })).toBeVisible();

  // Home counts them for the remembered folder.
  await page.goto("/");
  const folder = page.locator(".list-row", { hasText: "Agent runs" });
  await expect(folder.locator(".list-new")).toHaveText("2 new");

  // A bot that fetches the page HTML (a link unfurler) doesn't count as a person.
  expect((await request.get(`/?key=seen-a-${stamp}&persist=1`)).status()).toBe(200);
  expect((await (await request.get(`/api/content?key=seen-a-${stamp}`)).json()).unseen).toBe(true);

  // A person opens one: it is seen; the other stays new.
  await page.goto(`/c?token=${created.creator_id}`);
  await page.getByRole("link", { name: /Agent run \(new\)/ }).click();
  await expect(page.getByRole("heading", { name: "Agent run" })).toBeVisible();
  await expect.poll(async () => (await (await request.get(`/api/content?key=seen-a-${stamp}`)).json()).unseen).toBe(false);
  await page.goto(`/c?token=${created.creator_id}`);
  await expect(rows.locator(".list-dot")).toHaveCount(1);
  await expect(page.getByRole("link", { name: /Second run \(new\)/ })).toBeVisible();
  await page.goto("/");
  await expect(folder.locator(".list-new")).toHaveText("1 new");

  // The agent changes the seen note again: new again.
  await request.post("/api/content", { data: { key: `seen-a-${stamp}`, content: "- one more step", mode: "append" } });
  await page.reload();
  await expect(folder.locator(".list-new")).toHaveText("2 new");

  // Marking seen over the API (any client) clears it.
  for (const key of [`seen-a-${stamp}`, `seen-b-${stamp}`]) {
    expect((await request.patch("/api/meta", { data: { key, seen: true } })).status()).toBe(200);
  }
  await page.reload();
  await expect(folder.locator(".list-new")).toHaveCount(0);
  await expect(folder.locator(".list-dot")).toHaveCount(0);
});
