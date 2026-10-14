import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Grades prose tables against tests/fixtures/figma-tables.json (Figma TableRow and TableRecord)
 * in light and dark: the desktop grid at 1280px (Regular), and at 390px the phone grid (Compact)
 * and a prose table stacked into records. Each node property is one row; passes only at 100% (A+).
 * Behaviour that Figma can only show as a picture is checked alongside: stacked records never
 * overflow, no word in a cell is split, and a wide grid scrolls out to the screen edge.
 */
type Rgba = { hex: string; alpha: number };
const tokens: { color: Record<string, { light: Rgba; dark: Rgba }>; text: Record<string, { family: string; weight: number; size: number; lineHeight: number }> } =
  JSON.parse(readFileSync("tests/fixtures/figma-tokens.json", "utf8"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const figma: any = JSON.parse(readFileSync("tests/fixtures/figma-tables.json", "utf8"));

const sources = [
  ["The economics of frontier models", "2:14", "Training costs keep rising about 3× a year, but inference prices fall faster.", "Agents get cheaper to run long before they get cheaper to build."],
  ["Charles on retries and rate limiting", "11:02", "Most outages in the incident log trace back to retry storms, not raw load.", "Back off before adding capacity; the fix is in the client."],
  ["Notes on limiting context", "38:40", "Stale notes hurt answers more than long ones do.", "Keep what agents read fresh rather than short."],
];
const NOTE = [
  "# Reading list, week 41",
  "",
  "Three talks from this week, and what each one changes for us.",
  "",
  "| Source | Claim | Why it matters |",
  "| --- | --- | --- |",
  ...sources.map(([s, t, c, w], i) => `| [${s}](https://example.com/${i}) · ${t} | ${c} | ${w} |`),
  "",
  "## Plan",
  "",
  "| Task | Owner | Due |",
  "| --- | --- | --- |",
  "| Launch post | Lawrence | Oct 14 |",
  "| API limits | Agent | Oct 16 |",
  "",
  "## Numbers",
  "",
  "| Region | Jan | Feb | Mar | Apr | May | Jun | Source |",
  "| --- | --- | --- | --- | --- | --- | --- | --- |",
  "| North | 1,204 | 1,388 | 1,402 | 1,517 | 1,630 | 1,702 | https://example.com/a/very/long/path/to/the/regional/report |",
  "",
  ...Array.from({ length: 30 }, (_, i) => `Closing paragraph ${i + 1}.\n`),
].join("\n");

type Row = { scheme: string; surface: string; property: string; expected: string; actual: string; pass: boolean };
type Box = {
  width: number; height: number; left: number; right: number; padding: number[]; background: string; gap: number; display: string; direction: string; align: string;
  marginBottom: number; border: { width: number; color: string }[]; color: string; family: string; weight: string; size: string; lineHeight: string;
};
const read = (locator: Locator, pseudo?: string): Promise<Box> =>
  locator.first().evaluate((element, pseudo) => {
    const s = getComputedStyle(element, pseudo), r = element.getBoundingClientRect();
    const side = (n: string) => ({ width: parseFloat(s.getPropertyValue(`border-${n}-width`)), color: s.getPropertyValue(`border-${n}-color`) });
    return {
      width: r.width, height: r.height, left: r.left, right: r.right,
      padding: [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft].map(parseFloat),
      background: s.backgroundColor, gap: parseFloat(s.rowGap) || 0, display: s.display, direction: s.flexDirection, align: s.verticalAlign,
      marginBottom: parseFloat(s.marginBottom), border: ["top", "right", "bottom", "left"].map(side),
      color: s.color, family: s.fontFamily, weight: s.fontWeight, size: s.fontSize, lineHeight: s.lineHeight,
    };
  }, pseudo);

const channels = (color: string) => {
  const n = color.match(/[\d.]+/g)!.map(Number);
  const rgb = color.startsWith("color(") ? n.slice(0, 3).map(c => Math.round(c * 255)) : n.slice(0, 3);
  return { rgb, alpha: n[3] ?? 1 };
};
const hex = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const show = (color: string) => { const c = channels(color); return c.alpha === 0 ? "none" : `rgb(${c.rgb.join(",")})${c.alpha < 1 ? ` / ${+c.alpha.toFixed(2)}` : ""}`; };
const grade = (score: number) => (score === 1 ? "A+" : score >= 0.97 ? "A" : score >= 0.9 ? "A-" : score >= 0.8 ? "B" : "C");

/** Words inside table links that start on one line and end on the next (split or hyphenated). */
const splitLinks = (page: Page) =>
  page.locator(".prose-table td a").evaluateAll(links => links.filter(a => {
    // A word in a link that starts on one line and ends on the next was split mid-word.
    const walker = document.createTreeWalker(a, NodeFilter.SHOW_TEXT);
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      const value = text.textContent ?? "";
      for (const match of value.matchAll(/\S+/g)) {
        const range = document.createRange();
        range.setStart(text, match.index!); range.setEnd(text, match.index! + match[0].length);
        if (new Set([...range.getClientRects()].map(r => Math.round(r.top))).size > 1) return true;
      }
    }
    return false;
  }).length);

async function suite(page: Page, scheme: "light" | "dark", rows: Row[], key: string) {
  const tok = (name: string | null) => (name ? tokens.color[name][scheme] : null);
  const same = (actual: string, name: string | null) => {
    const want = tok(name), a = channels(actual);
    if (!want) return a.alpha === 0;
    return Math.abs(a.alpha - want.alpha) <= 0.01 && hex(want.hex).every((c, i) => Math.abs(c - a.rgb[i]) <= 1);
  };
  const wantText = (name: string | null) => (name ? `${name} ${tok(name)!.hex}${tok(name)!.alpha < 1 ? ` / ${tok(name)!.alpha}` : ""}` : "none");
  let surface = "";
  const row = (property: string, expected: string, actual: string, pass: boolean) => rows.push({ scheme, surface, property, expected, actual, pass });
  const num = (property: string, want: number, got: number, t = 0.5) => row(property, `${want}px`, `${+got.toFixed(2)}px`, Math.abs(got - want) <= t);
  const color = (property: string, token: string | null, got: string) => row(property, wantText(token), show(got), same(got, token));
  const type = (prefix: string, want: { style: string; token: string }, got: Box) => {
    const style = tokens.text[want.style];
    color(`${prefix} colour`, want.token, got.color);
    const face = got.family.split(",")[0].replace(/"/g, "").toLowerCase().replace(/[\s_-]/g, "");
    row(`${prefix} family`, style.family, got.family.split(",")[0], face.startsWith("geist") && face.startsWith("geistmono") === (style.family === "Geist Mono"));
    row(`${prefix} weight`, String(style.weight), got.weight, got.weight === String(style.weight));
    num(`${prefix} size`, style.size, parseFloat(got.size));
    num(`${prefix} line-height`, style.lineHeight, parseFloat(got.lineHeight));
  };
  const stroke = (property: string, side: number, want: { token: string; width: number } | null, got: Box) => {
    const b = got.border[side], drawn = channels(b.color).alpha === 0 ? 0 : b.width;
    num(`${property} width`, want ? want.width : 0, drawn);
    if (want && want.width) color(`${property} colour`, want.token, b.color);
  };
  // A grid row in Figma is an auto-layout frame; in HTML its padding and gap live on the cells.
  async function gridRow(name: string, cells: Locator, spec: typeof figma.TableRow.Regular, text: { style: string; token: string }) {
    surface = name;
    const count = await cells.count();
    const first = await read(cells.nth(0)), last = await read(cells.nth(count - 1));
    num("padding-top", spec.padding[0], first.padding[0]);
    num("padding-bottom", spec.padding[2], first.padding[2]);
    num("column gap", spec.gap, first.padding[1]);
    num("padding-right (last)", spec.padding[1], last.padding[1]);
    num("padding-left", spec.padding[3], first.padding[3]);
    row("cell alignment", spec.align, first.align, first.align === spec.align);
    color("fill", spec.fill, first.background);
    stroke("bottom rule", 2, spec.bottom, first);
    stroke("left rule", 3, null, first);
    stroke("right rule", 1, null, first);
    type("text", text, first);
  }

  await page.emulateMedia({ colorScheme: scheme });

  // ---- Desktop: both tables are grids at the Regular density.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/?key=${key}&persist=1`);
  const tables = page.locator(".prose-table");
  await expect(tables).toHaveCount(3);
  await page.evaluate(() => document.fonts.ready);
  const reading = tables.nth(0), plan = tables.nth(1);
  surface = "Table · desktop";
  row("reading list shape", "prose", String(await reading.getAttribute("data-shape")), (await reading.getAttribute("data-shape")) === "prose");
  row("plan shape", "grid", String(await plan.getAttribute("data-shape")), (await plan.getAttribute("data-shape")) === "grid");
  stroke("top rule", 0, figma.Table.top, await read(reading.locator("table")));
  row("reading list stays a grid", "table-row", (await read(reading.locator("tr").nth(1))).display, (await read(reading.locator("tr").nth(1))).display === "table-row");
  await gridRow("TableRow Header · Regular", reading.locator("thead th"), figma.TableRow.Regular, figma.TableRow.Regular.header);
  await gridRow("TableRow Body · Regular", reading.locator("tbody tr").first().locator("td"), figma.TableRow.Regular, figma.TableRow.Regular.body);
  surface = "Behaviour · desktop";
  row("no link split mid-word", "0", String(await splitLinks(page)), (await splitLinks(page)) === 0);
  await gridRow("TableRow Body · Regular (plan)", plan.locator("tbody tr").first().locator("td"), figma.TableRow.Regular, figma.TableRow.Regular.body);

  // ---- Phone: the short table is a Compact grid; the prose table stacks into records.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(100);
  surface = "Table · phone";
  stroke("top rule", 0, figma.Table.top, await read(plan.locator("table")));
  await gridRow("TableRow Header · Compact", plan.locator("thead th"), figma.TableRow.Compact, figma.TableRow.Compact.header);
  await gridRow("TableRow Body · Compact", plan.locator("tbody tr").first().locator("td"), figma.TableRow.Compact, figma.TableRow.Compact.body);

  surface = "TableRecord";
  const rec = figma.TableRecord;
  stroke("table top rule", 0, figma.Table.top, await read(reading.locator("table")));
  const head = await read(reading.locator("thead"));
  row("header row", "hidden", `${head.width}×${head.height}`, head.width <= 1 && head.height <= 1);
  const record = reading.locator("tbody tr").first(), r = await read(record);
  row("layout", "vertical", `${r.display} ${r.direction}`, r.display === "flex" && r.direction === "column");
  ["top", "right", "bottom", "left"].forEach((s, i) => num(`padding-${s}`, rec.padding[i], r.padding[i]));
  num("gap", rec.gap, r.gap);
  stroke("bottom rule", 2, rec.bottom, r);
  num("width (column)", 358, r.width);
  type("heading", rec.heading, await read(record.locator("td").first()));
  const field = record.locator("td").nth(1), label = await read(field, "::before");
  type("label", rec.label, label);
  num("label → value", rec.fieldGap, label.marginBottom);
  type("value", rec.value, await read(field));
  const labelText = await field.evaluate(e => getComputedStyle(e, "::before").content);
  row("label text", '"Claim"', labelText, labelText === '"Claim"');
  for (const [i, cell] of [record.locator("td").nth(0), field, record.locator("td").nth(2)].entries()) {
    const box = await read(cell);
    stroke(`field ${i + 1} rules`, 2, null, box);
    num(`field ${i + 1} padding`, 0, box.padding[0] + box.padding[1] + box.padding[2] + box.padding[3]);
  }

  // Behaviour the frames show as pictures.
  surface = "Behaviour · phone";
  const overflow = await reading.evaluate(e => e.scrollWidth - e.clientWidth);
  row("stacked records fit the column", "0px overflow", `${overflow}px`, overflow <= 0);
  row("no link split mid-word", "0", String(await splitLinks(page)), (await splitLinks(page)) === 0);
  const wide = tables.nth(2), w = await read(wide);
  row("wide grid shape", "grid", String(await wide.getAttribute("data-shape")), (await wide.getAttribute("data-shape")) === "grid");
  const scrolls = await wide.evaluate(e => e.scrollWidth > e.clientWidth);
  row("wide grid scrolls sideways", "scrolls", scrolls ? "scrolls" : "fits", scrolls);
  num("wide grid reaches the screen edge", 390, w.right);
  num("page has no sideways scroll", 390, await page.evaluate(() => document.documentElement.scrollWidth));
}

test("tables match the Figma table components, property for property", async ({ page, request }, info) => {
  test.skip(info.project.name !== "chromium", "Viewports are set explicitly; graded once in Chromium");
  test.setTimeout(120_000);
  const key = `tables-${Date.now()}`;
  await request.post("/api/content", { data: { key, content: NOTE } });
  const rows: Row[] = [];
  for (const scheme of ["light", "dark"] as const) await suite(page, scheme, rows, key);
  const passed = rows.filter(r => r.pass).length, score = passed / rows.length;
  const report = [
    `# Figma tables: ${grade(score)} (${passed}/${rows.length})`,
    "",
    "| Scheme | Surface | Property | Expected (Figma) | Actual (app) | |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows.map(r => `| ${r.scheme} | ${r.surface} | ${r.property} | ${r.expected} | ${r.actual} | ${r.pass ? "pass" : "FAIL"} |`),
  ].join("\n");
  await info.attach("figma-tables.md", { body: report, contentType: "text/markdown" });
  console.log(report.split("\n")[0]);
  for (const r of rows.filter(r => !r.pass)) console.log(`FAIL ${r.scheme} ${r.surface} · ${r.property}: want ${r.expected}, got ${r.actual}`);
  expect(rows.filter(r => !r.pass).length, report.split("\n")[0]).toBe(0);
});

test("on a phone the scroll arrows step aside while the page moves", async ({ page, request }) => {
  const key = `tables-arrows-${Date.now()}`;
  await request.post("/api/content", { data: { key, content: NOTE } });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/?key=${key}&persist=1`);
  await expect(page.locator(".prose-table").first()).toBeVisible();
  const arrows = page.locator(".scroll-actions");
  const opacity = () => arrows.evaluate(e => getComputedStyle(e).opacity);
  await page.evaluate(() => window.scrollTo(0, 400));
  await expect.poll(opacity, { timeout: 300 }).not.toBe("1");
  await expect(arrows).toHaveClass(/pointer-events-none/);
  await expect.poll(opacity, { timeout: 3000 }).toBe("1");
  await expect(page.getByRole("button", { name: "Scroll to top" })).toBeVisible();
});

test("on a wide screen the scroll arrows stay put while the page moves", async ({ page, request }, info) => {
  test.skip(info.project.name !== "chromium", "Desktop width");
  const key = `tables-arrows-wide-${Date.now()}`;
  await request.post("/api/content", { data: { key, content: NOTE } });
  await page.setViewportSize({ width: 1280, height: 700 });
  await page.goto(`/?key=${key}&persist=1`);
  await expect(page.locator(".prose-table").first()).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 400));
  await page.waitForTimeout(100);
  await expect(page.locator(".scroll-actions")).not.toHaveClass(/pointer-events-none/);
});
