import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

/**
 * Grades the running app against the Figma export in tests/fixtures/figma-tokens.json,
 * one property at a time. Passes only at 100% (A+). Regenerate the fixture from the
 * Figma Foundations page whenever it changes; a failing row names the exact drift.
 */
type Rgba = { hex: string; alpha: number };
type Fixture = {
  color: Record<string, { css: string; light: Rgba; dark: Rgba }>;
  motion: Record<string, { css: string; value: number | string }>;
  text: Record<string, { family: string; weight: number; size: number; lineHeight: number | null; underline: boolean }>;
};
const figma: Fixture = JSON.parse(readFileSync("tests/fixtures/figma-tokens.json", "utf8"));

/** Where each Figma text style lives in rendered prose. Styles not listed are UI styles, graded once PR 2 builds those components. */
const TEXT_SELECTORS: Record<string, string> = {
  "Title/H1": ".prose h1",
  "Prose/H2": ".prose h2",
  "Prose/H3": ".prose h3",
  "Prose/H4": ".prose h4",
  "Prose/H5": ".prose h5",
  "Prose/Body": ".prose p",
  "Prose/Body Italic": ".prose p em",
  "Prose/Table Header": ".prose th",
  "Prose/Link": ".prose p a",
  "Mono/Code": ".prose pre code",
};

const note = `# Title

Body with *emphasis* and a [link](https://example.com).

## Two

### Three

#### Four

##### Five

| Head | Other |
| --- | --- |
| cell | cell |

\`\`\`
const answer = 42;
\`\`\`
`;

type Row = { group: string; name: string; property: string; expected: string; actual: string; pass: boolean };

const channels = (color: string) => {
  const n = color.match(/[\d.]+/g)!.map(Number);
  const rgb = color.startsWith("color(") ? n.slice(0, 3).map(c => c * 255) : n.slice(0, 3);
  return { rgb, alpha: n[3] ?? 1 };
};
const fromHex = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
/** What a colour looks like over paper: the only thing a reader sees. */
const over = (rgb: number[], alpha: number, paper: number[]) => rgb.map((c, i) => Math.round(c * alpha + paper[i] * (1 - alpha)));
const show = (rgb: number[]) => `rgb(${rgb.join(", ")})`;
const motionValue = (name: string, value: number | string) => {
  if (name.startsWith("duration/")) return `${value}ms`;
  if (name === "enter/view") return `${String(value).match(/y (\d+)→0/)![1]}px`;
  return String(value);
};
/** Canonical form for comparison: the CSS minifier rewrites 150ms as .15s and 0.99 as .99. */
const squash = (value: string) =>
  value
    .replace(/\s+/g, "")
    .replace(/(\d*\.?\d+)(ms|s)\b/g, (_, n, unit) => `${+(Number(n) * (unit === "s" ? 1000 : 1)).toFixed(3)}ms`)
    .replace(/(^|[(,])(\d*\.\d+|\d+)(?=[),]|$)/g, (_, lead, n) => `${lead}${+n}`);
const grade = (score: number) => (score === 1 ? "A+" : score >= 0.97 ? "A" : score >= 0.9 ? "A-" : score >= 0.8 ? "B" : "C");

test("the app matches the Figma design system, property for property", async ({ page, request }, info) => {
  const rows: Row[] = [];
  const key = `figma-eval-${info.project.name}-${Date.now()}`;
  await request.post("/api/content", { data: { key, content: note } });

  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(`/?key=${key}&persist=1`);
    await expect(page.getByRole("heading", { name: "Five" })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);

    const live = await page.evaluate(
      ({ colors, motion, selectors }) => {
        const probe = document.body.appendChild(document.createElement("span"));
        const color: Record<string, string> = {};
        for (const name of colors) {
          probe.style.color = `var(${name})`;
          color[name] = getComputedStyle(probe).color;
        }
        probe.remove();
        const root = getComputedStyle(document.documentElement);
        const motionOut: Record<string, string> = {};
        for (const name of motion) motionOut[name] = root.getPropertyValue(name).trim();
        const text: Record<string, { family: string; weight: string; size: string; lineHeight: string; decoration: string } | null> = {};
        for (const [style, selector] of Object.entries(selectors)) {
          const element = document.querySelector(selector);
          if (!element) { text[style] = null; continue; }
          const s = getComputedStyle(element);
          text[style] = { family: s.fontFamily, weight: s.fontWeight, size: s.fontSize, lineHeight: s.lineHeight, decoration: s.textDecorationLine };
        }
        return { color, motion: motionOut, text };
      },
      {
        colors: Object.values(figma.color).map(c => c.css),
        motion: Object.values(figma.motion).map(m => m.css),
        selectors: TEXT_SELECTORS,
      },
    );

    const paper = fromHex(figma.color["bg/paper"][scheme].hex);
    for (const [name, token] of Object.entries(figma.color)) {
      const want = token[scheme];
      const expected = over(fromHex(want.hex), want.alpha, paper);
      const got = channels(live.color[token.css]);
      const actual = over(got.rgb, got.alpha, paper);
      rows.push({
        group: `color · ${scheme}`, name, property: token.css,
        expected: show(expected), actual: show(actual),
        pass: expected.every((c, i) => Math.abs(c - actual[i]) <= 1),
      });
    }

    if (scheme === "light") {
      for (const [name, token] of Object.entries(figma.motion)) {
        const expected = motionValue(name, token.value), actual = live.motion[token.css] || "(unset)";
        rows.push({ group: "motion", name, property: token.css, expected, actual, pass: squash(expected) === squash(actual) });
      }
      for (const [style, selector] of Object.entries(TEXT_SELECTORS)) {
        // On a phone the table takes the Compact row density (Figma TableRow; graded in full by
        // figma-tables.spec.ts), so its header is UI/Small SemiBold rather than Prose/Table Header.
        const narrow = (page.viewportSize()?.width ?? 1280) < 640 + 32;
        const want = figma.text[style === "Prose/Table Header" && narrow ? "UI/Small SemiBold" : style], got = live.text[style];
        const check = (property: string, expected: string, actual: string | undefined, pass: boolean) =>
          rows.push({ group: "type", name: style, property, expected, actual: actual ?? `(no ${selector})`, pass: !!got && pass });
        const family = got?.family.split(",")[0].replace(/"/g, "").trim();
        // next/font registers faces under its own names (e.g. "geistItalic"); match the family, not the casing.
        const face = family?.toLowerCase().replace(/[\s_-]/g, "");
        const isMono = !!face && face.startsWith("geistmono");
        check("family", want.family, family, !!face && face.startsWith("geist") && isMono === (want.family === "Geist Mono"));
        check("weight", String(want.weight), got?.weight, got?.weight === String(want.weight));
        check("size", `${want.size}px`, got?.size, got?.size === `${want.size}px`);
        check("line-height", `${want.lineHeight}px`, got?.lineHeight, !!got && Math.abs(parseFloat(got.lineHeight) - want.lineHeight!) <= 0.5);
        check("underline", String(want.underline), got ? String(got.decoration.includes("underline")) : undefined, !!got && got.decoration.includes("underline") === want.underline);
      }
    }
  }

  const passed = rows.filter(row => row.pass).length;
  const score = passed / rows.length;
  const pending = Object.keys(figma.text).filter(style => !(style in TEXT_SELECTORS));
  const report = [
    `# Figma eval: ${grade(score)} (${passed}/${rows.length})`,
    "",
    "| Group | Figma | Property | Expected | Actual | |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows.map(r => `| ${r.group} | ${r.name} | ${r.property} | ${r.expected} | ${r.actual} | ${r.pass ? "pass" : "FAIL"} |`),
    "",
    `Not graded until PR 2 (UI text styles): ${pending.join(", ")}.`,
  ].join("\n");
  await info.attach("figma-eval.md", { body: report, contentType: "text/markdown" });
  console.log(report.split("\n")[0]);
  expect(rows.filter(row => !row.pass), report).toEqual([]);
});
