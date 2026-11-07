import { expect, test } from "@playwright/test";

const code = "const prompt = `Make the ${\"subject\"} glow`;\n\n  indented line that runs on and on so the block has to scroll sideways on a phone, well past the right edge\nlast();";
const content = `# Copy code\n\nIntro.\n\n\`\`\`ts\n${code}\n\`\`\`\n\n\`\`\`\nsecond block\n\`\`\`\n`;

test("each fenced code block has a pinned Copy button that copies its exact text", async ({ page, context, request }, info) => {
  const touch = info.project.name === "iphone-webkit";
  const key = `code-copy-${info.project.name}-${Date.now()}`;
  await request.post("/api/content", { data: { key, content } });
  if (touch) {
    // WebKit has no clipboard permission to grant; capture what the page writes instead.
    await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { value: {
      writeText: async (value: string) => { (window as unknown as { copied: string }).copied = value; },
    } }));
  } else {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  }
  await page.goto(`/?key=${key}&persist=1`);

  const blocks = page.locator(".prose .code-block");
  await expect(blocks).toHaveCount(2);
  const first = blocks.first();
  const button = first.getByRole("button", { name: "Copy", exact: true });
  await expect(button).toHaveCount(1);

  // Quiet until hover or focus on desktop; always shown where there is no hover.
  if (!touch) {
    await page.mouse.move(0, 0);
    await expect(button).toHaveCSS("opacity", "0");
    await first.hover();
    await expect(button).toHaveCSS("opacity", "1");
  } else {
    await expect(button).toHaveCSS("opacity", "1");
  }

  // Pinned: scrolling the block sideways leaves the button where it was.
  const before = await button.boundingBox();
  await first.locator("pre").evaluate(pre => { pre.scrollLeft = pre.scrollWidth; });
  expect(await button.boundingBox()).toEqual(before);

  if (touch) await button.tap(); else await button.click();
  const copied = first.getByRole("button", { name: "Copied", exact: true });
  await expect(copied).toBeVisible();
  const clip = touch
    ? await page.evaluate(() => (window as unknown as { copied: string }).copied)
    : await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toBe(code);
  await page.screenshot({ animations: "disabled", path: `test-results/code-copy-${info.project.name}.png` });
  await expect(first.getByRole("button", { name: "Copy", exact: true })).toBeVisible({ timeout: 3_000 });

  // Keyboard: focus the second block's button and press Enter.
  const second = blocks.nth(1).getByRole("button", { name: "Copy", exact: true });
  await second.focus();
  await expect(second).toHaveCSS("opacity", "1");
  await page.keyboard.press("Enter");
  await expect(blocks.nth(1).getByRole("button", { name: "Copied", exact: true })).toBeVisible();
  const clip2 = touch
    ? await page.evaluate(() => (window as unknown as { copied: string }).copied)
    : await page.evaluate(() => navigator.clipboard.readText());
  expect(clip2).toBe("second block");

  // The editor is unchanged: no copy buttons in edit mode's textarea.
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByPlaceholder("Write markdown…")).toHaveValue(content);
});
