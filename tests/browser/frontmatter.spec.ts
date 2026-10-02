import { expect, test } from "@playwright/test";

const content = `---
title: Small launch
status: draft
last-updated: 2026-09-30
ready: false
tags: [planning, design]
review:
  owner: Demo team
  round: 2
summary: |
  A short synthetic plan.
  Another line of metadata.
---
# Small launch

The tiny dinosaur won the design review.

1. [ ] Review the plan

[Example link](https://example.com)

\`\`\`yaml
status: this stays code
\`\`\`
`;

for (const colorScheme of ["light", "dark"] as const) {
  test(`metadata collapses and expands without changing Markdown or quote anchors in ${colorScheme}`, async ({ page, request }, info) => {
    await page.emulateMedia({ colorScheme });
    const key = `metadata-${colorScheme}-${info.project.name}-${Date.now()}`;
    await request.post("/api/content", { data: { key, content } });
    await page.goto(`/?key=${key}&persist=1`);
    const details = page.locator(".metadata-callout");
    const summary = details.locator("summary");
    await expect(details).not.toHaveAttribute("open");
    await expect(details.getByText("draft", { exact: true })).not.toBeVisible();
    await expect(page.getByRole("heading", { name: "Small launch" })).toHaveCount(1);
    await expect(page.getByRole("link", { name: "Example link" })).toBeVisible();
    await expect(page.locator(".prose pre")).toHaveText("status: this stays code");
    await page.screenshot({ path: `test-results/metadata-collapsed-${colorScheme}-${info.project.name}.png`, fullPage: true });
    if (info.project.name === "iphone-webkit") await summary.tap();
    else { await summary.focus(); await page.keyboard.press("Enter"); }
    await expect(details).toHaveAttribute("open", "");
    for (const value of ["draft", "false", "2026-09-30", "planning", "Demo team", "2"]) await expect(details.getByText(value, { exact: true })).toBeVisible();
    await expect(details.getByText("A short synthetic plan.", { exact: false })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/metadata-expanded-${colorScheme}-${info.project.name}.png`, fullPage: true });
    await summary.click();
    await expect(details).not.toHaveAttribute("open");
    const checkbox = page.getByRole("checkbox", { name: "Review the plan" });
    await expect(checkbox).toBeEnabled();
    await checkbox.click();
    await expect.poll(async () => (await (await request.get(`/api/drafts?key=${key}`)).json()).responses.length).toBe(1);
    const phrase = "The tiny dinosaur won the design review.";
    const span = page.locator(".prose [data-source-start]").filter({ hasText: phrase });
    expect(await span.getAttribute("data-source-start")).toBe(String(content.indexOf(phrase)));
    await span.evaluate(element => {
      window.getSelection()!.setBaseAndExtent(element.firstChild!, 9, element.firstChild!, 17);
      document.dispatchEvent(new Event("selectionchange"));
    });
    await page.getByRole("button", { name: "React to selection" }).click();
    await page.getByRole("button", { name: "Search emoji" }).click();
    await page.getByPlaceholder("Search").fill("dinosaur");
    await page.getByRole("button", { name: /brachiosaurus|tyrannosaurus/i }).first().click();
    await expect.poll(async () => (await (await request.get(`/api/comments?key=${key}`)).json()).comments.length).toBe(1);
    const state = await (await request.get(`/api/comments?key=${key}`)).json();
    expect(state.comments[0].anchor.exact).toBe("dinosaur");
    expect(state.comments[0].messages[0].text).toMatch(/[🦕🦖]/u);
    await page.reload();
    await expect(details).not.toHaveAttribute("open");
    await expect(checkbox).toBeChecked();
    await expect(page.locator(".prose mark").filter({ hasText: "dinosaur" })).toBeVisible();
  });
}

test("malformed metadata is readable and ordinary Markdown is preserved", async ({ page, request }, info) => {
  let key = `metadata-invalid-${info.project.name}-${Date.now()}`;
  await request.post("/api/content", { data: { key, content: "---\ntags: [unclosed\n---\n# Body survives\n\nA normal paragraph." } });
  await page.goto(`/?key=${key}&persist=1`);
  await expect(page.getByRole("heading", { name: "Body survives" })).toBeVisible();
  await page.locator(".metadata-callout summary").click();
  await expect(page.getByText("Couldn’t format this metadata. Original YAML:")).toBeVisible();
  await expect(page.locator(".metadata-callout pre")).toHaveText("tags: [unclosed");
  key = `metadata-unclosed-${info.project.name}-${Date.now()}`;
  await request.post("/api/content", { data: { key, content: "---\nstatus: draft\n\n# Unclosed body\n\nA normal paragraph." } });
  await page.goto(`/?key=${key}&persist=1`);
  await expect(page.locator(".metadata-callout")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Unclosed body" })).toBeVisible();
  await expect(page.locator(".prose").getByText("status: draft", { exact: true })).toBeVisible();
});
