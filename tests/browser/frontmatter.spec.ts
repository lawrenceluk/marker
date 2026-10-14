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
  test(`metadata reads inline and opens under "more" without changing Markdown or quote anchors in ${colorScheme}`, async ({ page, request }, info) => {
    await page.emulateMedia({ colorScheme });
    const key = `metadata-${colorScheme}-${info.project.name}-${Date.now()}`;
    await request.post("/api/content", { data: { key, content } });
    await page.goto(`/?key=${key}&persist=1`);
    // The first three short values read inline in the byline; the rest wait under "5 more".
    const byline = page.locator(".byline-block");
    await expect(byline.locator(".byline-values")).toHaveText("Small launch · draft · 2026-09-30");
    const more = byline.getByRole("button", { name: "5 more" });
    const list = byline.locator(".metadata-list");
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await expect(list).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Small launch" })).toHaveCount(1);
    await expect(page.getByRole("link", { name: "Example link" })).toBeVisible();
    await expect(page.locator(".prose pre")).toHaveText("status: this stays code");
    await page.screenshot({ path: `test-results/metadata-collapsed-${colorScheme}-${info.project.name}.png`, fullPage: true });
    if (info.project.name === "iphone-webkit") await more.tap();
    else { await more.focus(); await page.keyboard.press("Enter"); }
    const less = byline.getByRole("button", { name: "less" });
    await expect(less).toHaveAttribute("aria-expanded", "true");
    for (const [key, value] of [["status", "draft"], ["ready", "false"], ["last-updated", "2026-09-30"], ["tags", "planning, design"], ["review.owner", "Demo team"], ["review.round", "2"]]) {
      await expect(list.locator(".metadata-row").filter({ has: page.locator("dt", { hasText: new RegExp(`^${key.replace(".", "\\.")}$`) }) }).locator("dd")).toHaveText(value);
    }
    await expect(list.getByText("A short synthetic plan.", { exact: false })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/metadata-expanded-${colorScheme}-${info.project.name}.png`, fullPage: true });
    await less.click();
    await expect(list).toHaveCount(0);
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
    await expect(page.locator(".byline-block .metadata-list")).toHaveCount(0);
    await expect(checkbox).toBeChecked();
    await expect(page.locator(".prose mark").filter({ hasText: "dinosaur" })).toBeVisible();
  });
}

test("malformed metadata is readable and ordinary Markdown is preserved", async ({ page, request }, info) => {
  let key = `metadata-invalid-${info.project.name}-${Date.now()}`;
  await request.post("/api/content", { data: { key, content: "---\ntags: [unclosed\n---\n# Body survives\n\nA normal paragraph." } });
  await page.goto(`/?key=${key}&persist=1`);
  await expect(page.getByRole("heading", { name: "Body survives" })).toBeVisible();
  await page.locator(".byline-block").getByRole("button", { name: "metadata" }).click();
  await expect(page.getByText("Couldn’t format this metadata. Original YAML:")).toBeVisible();
  await expect(page.locator(".metadata-list pre")).toHaveText("tags: [unclosed");
  key = `metadata-unclosed-${info.project.name}-${Date.now()}`;
  await request.post("/api/content", { data: { key, content: "---\nstatus: draft\n\n# Unclosed body\n\nA normal paragraph." } });
  await page.goto(`/?key=${key}&persist=1`);
  await expect(page.locator(".byline-block")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Unclosed body" })).toBeVisible();
  await expect(page.locator(".prose").getByText("status: draft", { exact: true })).toBeVisible();
});
