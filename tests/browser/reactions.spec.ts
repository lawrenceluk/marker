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

test("toggling one checkbox leaves its siblings mounted and visually unchanged", async ({ page, request }, info) => {
  const key = `reaction-siblings-${info.project.name}`;
  await request.post("/api/content", { data: { key, content: "# Synthetic tidy\n\n1. [ ] First\n2. [ ] Second\n3. [ ] Third" } });
  await page.goto(`/?key=${key}&persist=1`);
  const first = page.getByRole("checkbox", { name: "First" });
  await expect(first).toBeEnabled();
  const colors = await first.evaluate(input => ({ accent: getComputedStyle(input).accentColor, foreground: getComputedStyle(document.body).color }));
  expect(colors.accent).toBe(colors.foreground);
  await page.route("**/api/responses", async route => {
    if (route.request().method() === "POST") await new Promise(resolve => setTimeout(resolve, 450));
    await route.continue();
  });
  const monitor = await page.evaluateHandle(() => {
    const input = document.querySelectorAll<HTMLInputElement>(".reaction-task input")[1];
    const item = input.closest("li")!;
    const samples: { connected: boolean; checked: boolean; disabled: boolean; className: string; opacity: string }[] = [];
    const mutations: string[] = [];
    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === "attributes" && (record.target === input || record.target === item)) mutations.push(record.attributeName ?? "attribute");
        if (record.type === "childList" && [...record.removedNodes].some(node => node === input || node === item || (node instanceof Element && node.contains(input)))) mutations.push("removed");
      }
    });
    observer.observe(item.parentElement!, { subtree: true, childList: true, attributes: true, attributeFilter: ["checked", "disabled", "class", "style"] });
    let running = true;
    const sample = () => {
      samples.push({ connected: input.isConnected, checked: input.checked, disabled: input.disabled, className: item.className, opacity: getComputedStyle(input).opacity });
      if (running) requestAnimationFrame(sample);
    };
    sample();
    return { finish: () => {
      running = false;
      observer.disconnect();
      return { samples, mutations, sameNode: input === document.querySelectorAll<HTMLInputElement>(".reaction-task input")[1] };
    } };
  });
  const saved = page.waitForResponse(response => response.url().endsWith("/api/responses") && response.request().method() === "POST");
  await first.tap();
  await saved;
  const outcome = await monitor.evaluate(value => value.finish());
  expect(outcome.samples.length).toBeGreaterThan(4);
  expect(outcome.samples.every(sample => sample.connected && !sample.checked && !sample.disabled && sample.className === "reaction-task" && sample.opacity === "1")).toBe(true);
  expect(outcome.mutations).toEqual([]);
  expect(outcome.sameNode).toBe(true);
  await expect(first).toBeChecked();
  await page.getByRole("checkbox", { name: "Second" }).tap();
  await page.getByRole("checkbox", { name: "Third" }).tap();
  await expect.poll(async () => (await (await request.get(`/api/responses?key=${key}`)).json()).responses.length).toBe(3);
  await page.reload();
  await expect(page.getByRole("checkbox", { name: "Second" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Third" })).toBeChecked();
});
