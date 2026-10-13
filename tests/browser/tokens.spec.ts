import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

/** Contrast floors for the palette, read live from the page. Exact values are graded against Figma in figma-eval.spec.ts. */
const channels = (color: string) => {
  const n = color.match(/[\d.]+/g)!.map(Number);
  return color.startsWith("color(") ? n.slice(0, 3).map(c => c * 255) : n.slice(0, 3);
};
const relative = (color: string) => {
  const [r, g, b] = channels(color).map(c => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [relative(a), relative(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const PAIRS: [string, string][] = [
  ["--foreground", "--background"],
  ["--muted", "--background"],
  ["--accent-new", "--background"],
  ["--danger", "--background"],
  ["--on-slab", "--slab"],
  ["--on-slab-muted", "--slab"],
  ["--background", "--accent-new"],
];
const names = [...new Set(PAIRS.flat())];
// Fail fast if a pair names a token the design system no longer has.
const known = new Set(Object.values(JSON.parse(readFileSync("tests/fixtures/figma-tokens.json", "utf8")).color).map(c => (c as { css: string }).css));

for (const colorScheme of ["light", "dark"] as const) {
  test(`palette text pairs hold WCAG AA in ${colorScheme}`, async ({ page }) => {
    for (const name of names) expect(known.has(name), `${name} is in the Figma export`).toBe(true);
    await page.emulateMedia({ colorScheme });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Marker", exact: true })).toBeVisible();
    const resolved = await page.evaluate(tokens => {
      const probe = document.body.appendChild(document.createElement("span"));
      const out: Record<string, string> = {};
      for (const name of tokens) {
        probe.style.color = `var(${name})`;
        out[name] = getComputedStyle(probe).color;
      }
      probe.remove();
      return out;
    }, names);
    for (const [fg, bg] of PAIRS) expect(contrast(resolved[fg], resolved[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(resolved["--background"]);
  });
}
