import { test, expect } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test("mobile tidy checkboxes and multi-select ask persist and submit", async ({ page, request }, info) => {
  const key = `reactions-${info.project.name}`;
  const content = [
    "# Weekly tidy demo",
    "",
    "1. [ ] Clear the desk",
    "2. [ ] Archive drafts",
    "3. [ ] Collect links",
    "",
    "```ask",
    "id: next-review",
    "question: What should the next review include?",
    "type: multi",
    "options:",
    "- A shorter summary",
    "- Clear next steps",
    "- Fewer links",
    "other: true",
    "```",
  ].join("\n");
  await request.post("/api/content", { data: { key, content } });
  await page.goto(`/?key=${key}&persist=1`);
  const checkbox = page.getByRole("checkbox", { name: "Clear the desk" });
  await expect(checkbox).toBeVisible();
  await checkbox.tap();
  await expect(checkbox).toBeChecked();
  await expect.poll(async () => (await (await request.get(`/api/responses?key=${key}`)).json()).responses.length).toBe(1);
  await page.reload();
  await expect(checkbox).toBeChecked();
  await page.getByRole("button", { name: "A shorter summary" }).tap();
  await page.getByRole("button", { name: "Clear next steps" }).tap();
  await page.getByRole("button", { name: "Other" }).tap();
  await page.getByRole("textbox", { name: "Other answer for What should the next review include?" }).fill("A small action list");
  await expect(page.getByRole("textbox", { name: "Other answer for What should the next review include?" })).toHaveValue("A small action list");
  await page.screenshot({ path: `test-results/reactions-${info.project.name}.png`, fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "Send", exact: true }).tap();
  await expect(page.getByText("Responses sent")).toBeVisible();
  const state = await (await request.get(`/api/responses?key=${key}`)).json();
  expect(state.responses).toHaveLength(4);
  expect(state.responses.every((entry: { submitted_at: number | null }) => typeof entry.submitted_at === "number")).toBe(true);
  expect(state.responses.find((entry: { block_id: string }) => entry.block_id === "ask:next-review")).toMatchObject({
    selections: ["A shorter summary", "Clear next steps", "Other"], free_text: "A small action list", active: true,
  });
  await page.reload();
  await expect(page.getByRole("button", { name: "A shorter summary" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("textbox", { name: "Other answer for What should the next review include?" })).toHaveValue("A small action list");
});
