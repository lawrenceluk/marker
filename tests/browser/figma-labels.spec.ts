import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Grades the label audit against tests/fixtures/figma-labels.json (Figma BylineMetadata, Tag
 * Kind=Preview, and the "Labels — with / without" board) in light and dark: the byline's front
 * matter inline and opened, the red preview tag in every header, and the labels the board
 * removes. The browser server runs as a Vercel preview, so the tag is present. Passes only at
 * 100% (A+).
 */
type Rgba = { hex: string; alpha: number };
const tokens: { color: Record<string, { light: Rgba; dark: Rgba }>; text: Record<string, { family: string; weight: number; size: number; lineHeight: number }> } =
  JSON.parse(readFileSync("tests/fixtures/figma-tokens.json", "utf8"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const figma: any = JSON.parse(readFileSync("tests/fixtures/figma-labels.json", "utf8"));

const NOTE = `---
author: agent/claude
status: draft
date: 2026-10-09
reviewers: [lawrence, agent]
sources:
  - https://example.com/economics-of-frontier-models
  - https://example.com/retries-and-rate-limiting
summary: Three talks from this week, and what each one changes for how agents write and read notes.
budget:
  q3: 12000
  q4: 18000
owner: design
---
# Reading list, week 41

Three talks from this week.

\`\`\`ask
id: ship
question: When should we ship?
type: single
options:
- Friday
- Next week
\`\`\`
`;

type Row = { scheme: string; surface: string; property: string; expected: string; actual: string; pass: boolean };
type Box = {
  width: number; height: number; left: number; right: number; top: number; padding: number[]; radius: number; background: string; columnGap: number; marginTop: number;
  border: { width: number; color: string }[]; color: string; family: string; weight: string; size: string; lineHeight: string; decoration: string;
};
const read = (locator: Locator): Promise<Box> =>
  locator.first().evaluate(element => {
    const s = getComputedStyle(element), r = element.getBoundingClientRect();
    const side = (n: string) => ({ width: parseFloat(s.getPropertyValue(`border-${n}-width`)), color: s.getPropertyValue(`border-${n}-color`) });
    return {
      width: r.width, height: r.height, left: r.left, right: r.right, top: r.top,
      padding: [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft].map(parseFloat), radius: parseFloat(s.borderTopLeftRadius),
      background: s.backgroundColor, columnGap: parseFloat(s.columnGap) || 0, marginTop: parseFloat(s.marginTop),
      border: ["top", "right", "bottom", "left"].map(side),
      color: s.color, family: s.fontFamily, weight: s.fontWeight, size: s.fontSize, lineHeight: s.lineHeight, decoration: s.textDecorationLine,
    };
  });

const channels = (color: string) => {
  const n = color.match(/[\d.]+/g)!.map(Number);
  const rgb = color.startsWith("color(") ? n.slice(0, 3).map(c => Math.round(c * 255)) : n.slice(0, 3);
  return { rgb, alpha: n[3] ?? 1 };
};
const hex = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const show = (color: string) => { const c = channels(color); return c.alpha === 0 ? "none" : `rgb(${c.rgb.join(",")})${c.alpha < 1 ? ` / ${+c.alpha.toFixed(2)}` : ""}`; };
const grade = (score: number) => (score === 1 ? "A+" : score >= 0.97 ? "A" : score >= 0.9 ? "A-" : score >= 0.8 ? "B" : "C");

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
  const face = (got: Box) => got.family.split(",")[0].replace(/"/g, "").toLowerCase().replace(/[\s_-]/g, "");
  const type = (prefix: string, want: { style: string; token: string; underline?: boolean }, got: Box) => {
    const style = tokens.text[want.style];
    color(`${prefix} colour`, want.token, got.color);
    row(`${prefix} family`, style.family, got.family.split(",")[0], face(got).startsWith("geist") && face(got).startsWith("geistmono") === (style.family === "Geist Mono"));
    row(`${prefix} weight`, String(style.weight), got.weight, got.weight === String(style.weight));
    num(`${prefix} size`, style.size, parseFloat(got.size));
    num(`${prefix} line-height`, style.lineHeight, parseFloat(got.lineHeight));
    if (want.underline !== undefined) row(`${prefix} underline`, String(want.underline), got.decoration, got.decoration.includes("underline") === want.underline);
  };
  const stroke = (property: string, side: number, want: { token: string; width: number } | null, got: Box) => {
    const b = got.border[side], drawn = channels(b.color).alpha === 0 ? 0 : b.width;
    num(`${property} width`, want ? want.width : 0, drawn);
    if (want && want.width) color(`${property} colour`, want.token, b.color);
  };
  const absent = async (property: string, scope: Locator, labels: string[]) => {
    const text = await scope.innerText();
    const found = labels.filter(label => label === "Sort" ? /(^|\n)\s*Sort\s*(\n|$)/.test(text) || / Sort /.test(` ${text.replace(/\s+/g, " ")} `) : text.includes(label.trim()));
    row(property, "none", found.join(", ") || "none", found.length === 0);
  };

  await page.emulateMedia({ colorScheme: scheme });
  await page.setViewportSize({ width: 1280, height: 900 });

  // ---- The note: byline, metadata, preview tag, and no ask hint or banner.
  await page.goto(`/?key=${key}&persist=1`);
  const byline = page.locator(".byline-block");
  await expect(byline).toBeVisible();
  await page.evaluate(() => document.fonts.ready);

  surface = "Byline";
  const line = byline.locator(".note-creator");
  num("gap", figma.Byline.gap, (await read(line)).columnGap);
  const folder = await read(line.locator(".byline-folder"));
  color("folder colour", figma.Byline.folder.token, folder.color);
  num("folder size", figma.Byline.folder.size, parseFloat(folder.size));
  row("folder weight", String(figma.Byline.folder.weight), folder.weight, folder.weight === String(figma.Byline.folder.weight));
  row("folder underline", "true", folder.decoration, folder.decoration.includes("underline"));
  const values = line.locator(".byline-values");
  type("values", figma.Byline.values, await read(values));
  const shown = (await values.innerText()).split(figma.Byline.values.separator);
  row("values inline", `≤${figma.Byline.values.max}, "${figma.Byline.values.separator}"`, `${shown.length}: ${shown.join(" | ")}`, shown.length <= figma.Byline.values.max && shown.length > 0);
  const more = line.locator(".byline-more");
  type("more", figma.Byline.more, await read(more));
  row("more text", "6 more", await more.innerText(), (await more.innerText()) === "6 more");

  surface = "MetadataList";
  await more.click();
  const list = byline.locator(".metadata-list");
  await expect(list).toBeVisible();
  const l = await read(list), spec = figma.MetadataList;
  num("gap above", spec.gapAbove, l.marginTop);
  stroke("top rule", 0, spec.top, l);
  const firstRow = list.locator(".metadata-row").first(), r = await read(firstRow);
  ["top", "right", "bottom", "left"].forEach((s, i) => num(`row padding-${s}`, spec.row.padding[i], r.padding[i]));
  num("row gap", spec.row.gap, r.columnGap);
  stroke("row bottom rule", 2, spec.row.bottom, r);
  const keyBox = await read(firstRow.locator("dt"));
  type("key", spec.key, keyBox);
  num("key width", spec.key.width, keyBox.width);
  type("value", spec.value, await read(firstRow.locator("dd")));
  row("rows", "9", String(await list.locator(".metadata-row").count()), (await list.locator(".metadata-row").count()) === 9);
  row("less text", "less", await more.innerText(), (await more.innerText()) === "less");
  await more.click();
  await expect(list).toHaveCount(0);

  surface = "PreviewTag · note";
  const toolbar = page.locator("nav.note-toolbar");
  const tag = toolbar.locator(".preview-tag");
  const t = await read(tag), ps = figma.PreviewTag;
  num("height", ps.height, t.height);
  ["top", "right", "bottom", "left"].forEach((s, i) => num(`padding-${s}`, ps.padding[i], t.padding[i]));
  row("shape", "pill", t.radius >= t.height / 2 ? "pill" : `${t.radius}px`, t.radius >= t.height / 2);
  color("fill", ps.fill, t.background);
  for (const [i, s] of ["top", "right", "bottom", "left"].entries()) stroke(`${s} edge`, i, null, t);
  type("label", ps.label, t);
  const visible = (await tag.evaluate(e => e.firstChild?.textContent ?? "")).trim();
  row("text", ps.text, visible, visible === ps.text);
  const moreButton = await read(toolbar.getByRole("button", { name: "More" }));
  num("gap to More", 8, moreButton.left - t.right);

  surface = "Removed · note";
  await absent("labels", page.locator("body"), ["Choose one", "Choose any that fit", "Choices saved as drafts", "Respond in chat", "Saving choices", "Preview sandbox", "Separate note namespace", "Open metadata demo", "Open reaction demo", "Open commenting demo"]);
  row("metadata disclosure", "none", String(await page.locator("details summary").count()), (await page.locator("details summary").count()) === 0);

  // ---- The editor: no status line; the shortcut is on Save's tooltip.
  surface = "Removed · editor";
  await toolbar.getByRole("button", { name: "Edit" }).click();
  const save = page.getByRole("button", { name: "Save", exact: true });
  await expect(save).toBeVisible();
  await absent("labels", page.locator("body"), ["Editing note", "New note ·", "Cmd/Ctrl+S to save"]);
  await save.hover();
  const tip = save.locator("[aria-hidden=true]").last();
  await expect.poll(() => tip.evaluate(e => getComputedStyle(e).opacity)).toBe("1");
  const tipText = await tip.innerText();
  row("Save tooltip", "⌘S or Ctrl+S", tipText, tipText === "⌘S" || tipText === "Ctrl+S");
  await page.getByRole("button", { name: "Cancel" }).click();
}

async function folderSuite(page: Page, scheme: "light" | "dark", rows: Row[], token: string) {
  const row = (surface: string, property: string, expected: string, actual: string, pass: boolean) => rows.push({ scheme, surface, property, expected, actual, pass });
  await page.emulateMedia({ colorScheme: scheme });
  await page.goto(`/c?token=${token}`);
  await expect(page.locator(".list .list-row").first()).toBeVisible();
  const sort = page.locator(".sort");
  const sortText = (await sort.innerText()).replace(/\s+/g, " ").trim();
  row("Removed · folder", "sort label", "updated created title", sortText, sortText.toLowerCase() === "updated created title");
  row("Removed · folder", "sort accessible name", "Sort", String(await sort.getAttribute("aria-label")), (await sort.getAttribute("aria-label")) === "Sort");
  const meta = (await page.locator(".list-meta").first().innerText()).split("\n")[0];
  row("Removed · folder", "row date", "date only", meta, /^[A-Z][a-z]{2} \d{1,2}, \d{4}$/.test(meta.trim()));
  const tag = page.locator("nav.note-toolbar .preview-tag");
  row("PreviewTag · folder", "present", "1", String(await tag.count()), (await tag.count()) === 1);
  await page.goto("/");
  const home = page.locator(".preview-tag");
  row("PreviewTag · home", "present", "1", String(await home.count()), (await home.count()) === 1);
}

test("the label audit matches the Figma board, property for property", async ({ page, request }, info) => {
  test.skip(info.project.name !== "chromium", "States are driven with a desktop pointer");
  test.setTimeout(120_000);
  const key = `labels-${Date.now()}`;
  const created = await (await request.post("/api/content", { data: { key, content: NOTE, creator_id: true, creator_name: "Design notes", tags: ["planning", "q3"] } })).json();
  // Open the folder first, so the note's folder name is a link (it is plain text to a stranger).
  await page.goto(`/c?token=${created.creator_id}`);
  await expect(page.locator(".list .list-row").first()).toBeVisible();
  const rows: Row[] = [];
  for (const scheme of ["light", "dark"] as const) {
    await suite(page, scheme, rows, key);
    await folderSuite(page, scheme, rows, created.creator_id);
  }
  const passed = rows.filter(r => r.pass).length, score = passed / rows.length;
  const report = [
    `# Figma labels: ${grade(score)} (${passed}/${rows.length})`,
    "",
    "| Scheme | Surface | Property | Expected (Figma) | Actual (app) | |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows.map(r => `| ${r.scheme} | ${r.surface} | ${r.property} | ${r.expected} | ${r.actual} | ${r.pass ? "pass" : "FAIL"} |`),
  ].join("\n");
  await info.attach("figma-labels.md", { body: report, contentType: "text/markdown" });
  console.log(report.split("\n")[0]);
  for (const r of rows.filter(r => !r.pass)) console.log(`FAIL ${r.scheme} ${r.surface} · ${r.property}: want ${r.expected}, got ${r.actual}`);
  expect(rows.filter(r => !r.pass).length, report.split("\n")[0]).toBe(0);
});
