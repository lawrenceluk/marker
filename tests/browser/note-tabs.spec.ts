import { expect, test } from "@playwright/test";

async function openOneOff(page: import("@playwright/test").Page, key: string) {
  await page.goto(`/?key=${encodeURIComponent(key)}`);
  await expect(page).toHaveURL(/\/n\/[A-Za-z0-9_-]+$/);
}

test("two tabs keep separate notes for one-off, persist, and folder opens", async ({
  browser,
  request,
}, info) => {
  const stamp = Date.now();
  const keyX = `tab-x-${info.project.name}-${stamp}`;
  const keyY = `tab-y-${info.project.name}-${stamp}`;
  await request.post("/api/content", {
    data: { key: keyX, content: "# Note X\nBody X." },
  });
  await request.post("/api/content", {
    data: { key: keyY, content: "# Note Y\nBody Y." },
  });

  const context = await browser.newContext();
  const pageX = await context.newPage();
  const pageY = await context.newPage();

  await openOneOff(pageX, keyX);
  await openOneOff(pageY, keyY);
  await expect(pageX.getByRole("heading", { name: "Note X" })).toBeVisible();
  await expect(pageY.getByRole("heading", { name: "Note Y" })).toBeVisible();

  await expect(pageX.getByRole("heading", { name: "Note X" })).toBeVisible();
  await expect(pageY.getByRole("heading", { name: "Note Y" })).toBeVisible();

  await pageX.getByRole("button", { name: "Edit", exact: true }).click();
  await pageX.getByPlaceholder("Write markdown…").fill("# Note X\nEdited in X.");
  await pageX.getByRole("button", { name: "Save" }).click();
  await expect(pageX.getByText("Edited in X.")).toBeVisible();
  await expect(pageY.getByRole("heading", { name: "Note Y" })).toBeVisible();
  await expect(pageY.getByRole("heading", { name: "Note Y" })).not.toContainText("Edited");

  const agentY = await request.get(`/api/content?key=${encodeURIComponent(keyY)}`);
  const bodyY = await agentY.json();
  expect(bodyY.content).toContain("Body Y");
  expect(bodyY.content).not.toContain("Edited in X");

  await context.close();
});

test("persist links stay isolated per tab", async ({ browser, request }, info) => {
  const keyX = `persist-x-${info.project.name}-${Date.now()}`;
  const keyY = `persist-y-${info.project.name}-${Date.now()}`;
  await request.post("/api/content", { data: { key: keyX, content: "# PX\nx." } });
  await request.post("/api/content", { data: { key: keyY, content: "# PY\ny." } });

  const context = await browser.newContext();
  const pageX = await context.newPage();
  const pageY = await context.newPage();
  await pageX.goto(`/?key=${encodeURIComponent(keyX)}&persist=1`);
  await pageY.goto(`/?key=${encodeURIComponent(keyY)}&persist=1`);
  await expect(pageX.getByRole("heading", { name: "PX" })).toBeVisible();
  await expect(pageY.getByRole("heading", { name: "PY" })).toBeVisible();

  await pageX.getByRole("button", { name: "Edit", exact: true }).click();
  await pageX.getByPlaceholder("Write markdown…").fill("# PX\nchanged.");
  await pageX.getByRole("button", { name: "Save" }).click();
  await expect(pageY.getByRole("heading", { name: "PY" })).toBeVisible();

  const check = await request.get(`/api/content?key=${encodeURIComponent(keyY)}`);
  expect((await check.json()).content).toContain("y.");

  await context.close();
});
