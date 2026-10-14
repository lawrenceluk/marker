import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Grades selection actions against tests/fixtures/figma-selection.json (Figma SelectionGroup,
 * ReactBar, ShortcutTooltip, SelectionBar): the slab selection, the desktop group in the right
 * margin with its C / E shortcuts and the − / + it gains after a double-click, the react bar, and
 * the phone bar along the bottom. Desktop is graded in Chromium in light and dark; the bar on the
 * iPhone project. Each passes only at 100% (A+).
 */
type Rgba = { hex: string; alpha: number };
const tokens: { color: Record<string, { light: Rgba; dark: Rgba }> } = JSON.parse(readFileSync("tests/fixtures/figma-tokens.json", "utf8"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const figma: any = JSON.parse(readFileSync("tests/fixtures/figma-selection.json", "utf8"));

const CONTENT = "We want to ship the folder view before Friday, ahead of the API limits work. Rollout starts with the five most active folders, then everyone else.";
const PHRASE = "the five most active folders";

type Row = { scheme: string; surface: string; property: string; expected: string; actual: string; pass: boolean };
type Box = { x: number; y: number; width: number; height: number; padding: number[]; radius: number; background: string; color: string; border: { width: number; color: string }[]; family: string; weight: string; size: string; lineHeight: string; opacity: string; columnGap: number };
const read = (locator: Locator, pseudo?: string): Promise<Box> =>
  locator.first().evaluate((element, pseudo) => {
    const s = getComputedStyle(element, pseudo), r = element.getBoundingClientRect();
    const side = (n: string) => ({ width: parseFloat(s.getPropertyValue(`border-${n}-width`)), color: s.getPropertyValue(`border-${n}-color`) });
    return {
      x: r.x, y: r.y, width: r.width, height: r.height, padding: [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft].map(parseFloat),
      radius: parseFloat(s.borderTopLeftRadius), background: s.backgroundColor, color: s.color, border: ["top", "right", "bottom", "left"].map(side),
      family: s.fontFamily, weight: s.fontWeight, size: s.fontSize, lineHeight: s.lineHeight, opacity: s.opacity, columnGap: parseFloat(s.columnGap) || 0,
    };
  }, pseudo);
const channels = (color: string) => {
  const n = color.match(/[\d.]+/g)!.map(Number);
  return { rgb: color.startsWith("color(") ? n.slice(0, 3).map(c => Math.round(c * 255)) : n.slice(0, 3), alpha: n[3] ?? 1 };
};
const hex = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const show = (color: string) => { const c = channels(color); return c.alpha === 0 ? "none" : `rgb(${c.rgb.join(",")})${c.alpha < 1 ? ` / ${+c.alpha.toFixed(2)}` : ""}`; };
const grade = (score: number) => (score === 1 ? "A+" : score >= 0.97 ? "A" : score >= 0.9 ? "A-" : score >= 0.8 ? "B" : "C");

function grader(rows: Row[], scheme: "light" | "dark") {
  let surface = "";
  const tok = (name: string | null) => (name ? tokens.color[name][scheme] : null);
  const same = (actual: string, name: string | null) => {
    const want = tok(name), a = channels(actual);
    if (!want) return a.alpha === 0;
    return Math.abs(a.alpha - want.alpha) <= 0.01 && hex(want.hex).every((c, i) => Math.abs(c - a.rgb[i]) <= 1);
  };
  const row = (property: string, expected: string, actual: string, pass: boolean) => rows.push({ scheme, surface, property, expected, actual, pass });
  return {
    at: (s: string) => { surface = s; },
    row,
    num: (property: string, want: number, got: number, t = 0.5) => row(property, `${want}px`, `${+got.toFixed(2)}px`, Math.abs(got - want) <= t),
    color: (property: string, token: string | null, got: string) => row(property, token ? `${token} ${tok(token)!.hex}` : "none", show(got), same(got, token)),
    stroke: (property: string, side: number, want: { token: string; width: number } | null, got: Box) => {
      const b = got.border[side], drawn = channels(b.color).alpha === 0 ? 0 : b.width;
      row(`${property} width`, `${want ? want.width : 0}px`, `${drawn}px`, Math.abs(drawn - (want ? want.width : 0)) <= 0.5);
      if (want && want.width) row(`${property} colour`, want.token, show(b.color), same(b.color, want.token));
    },
    order: async (property: string, want: string[], scope: Locator) => {
      const got = await scope.evaluate(el => Array.from(el.children).map(c => c.classList.contains("selection-divider") ? "divider" : c.classList.contains("selection-bar-spacer") ? "spacer"
        : (c.querySelector("button") ?? c).getAttribute("aria-label")?.replace(/ (on|to) selection$/, "").replace(/^Smaller selection$/, "Smaller").replace(/^Larger selection$/, "Larger").replace(/^React with .*/, "emoji") ?? "?").filter(n => n !== "spacer"));
      row(property, want.join(", "), got.join(", "), got.join() === want.join());
    },
  };
}

const selectPhrase = (page: Page) => page.locator(".prose [data-source-start]").filter({ hasText: CONTENT }).evaluate((element, phrase) => {
  const text = element.firstChild!, start = text.textContent!.indexOf(phrase);
  window.getSelection()!.setBaseAndExtent(text, start, text, start + phrase.length);
  document.dispatchEvent(new Event("selectionchange"));
}, PHRASE);

async function desktop(page: Page, scheme: "light" | "dark", rows: Row[], key: string) {
  const g = grader(rows, scheme);
  await page.emulateMedia({ colorScheme: scheme });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/?key=${key}&persist=1`);
  await expect(page.getByRole("button", { name: "Comments (0 open)" })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);

  g.at("Selection");
  const para = page.locator(".prose p").first();
  g.color("fill", figma.Selection.fill, (await read(para, "::selection")).background);
  g.color("text", figma.Selection.text, (await read(para, "::selection")).color);

  g.at("SelectionGroup · Default");
  await selectPhrase(page);
  const group = page.locator(".selection-group");
  await expect(group).toBeVisible();
  const spec = figma.SelectionGroup, b = await read(group);
  g.num("height", spec.height, b.height);
  ["top", "right", "bottom", "left"].forEach((s, i) => g.num(`padding-${s}`, spec.padding[i], b.padding[i]));
  g.row("shape", "pill", b.radius >= b.height / 2 ? "pill" : `${b.radius}px`, b.radius >= b.height / 2);
  g.color("fill", spec.fill, b.background);
  for (const [i, s] of ["top", "right", "bottom", "left"].entries()) g.stroke(`${s} edge`, i, null, b);
  await g.order("order", spec.order.Default, group);
  const commentButton = group.getByRole("button", { name: "Comment on selection" });
  const cb = await read(commentButton);
  g.num("button", spec.button, cb.width);
  g.color("icon", spec.icon, cb.color);
  const column = (await page.locator(".tap-select").boundingBox())!;
  g.num("gap from the column", spec.placement.marginGap, b.x - (column.x + column.width));
  const line = await page.evaluate(() => Array.from(window.getSelection()!.getRangeAt(0).getClientRects()).sort((a, c) => c.bottom - a.bottom)[0].toJSON());
  g.num("centred on the last line", (line.top + line.bottom) / 2, b.y + b.height / 2, 1);
  const keys = [await commentButton.getAttribute("aria-keyshortcuts"), await group.getByRole("button", { name: "React to selection" }).getAttribute("aria-keyshortcuts")];
  g.row("shortcuts", `${spec.keys.Comment}, ${spec.keys.React}`, keys.join(", "), keys.join() === `${spec.keys.Comment},${spec.keys.React}`);

  g.at("ShortcutTooltip");
  await commentButton.hover();
  const tip = commentButton.locator(".shortcut-tooltip");
  await expect.poll(async () => (await read(tip)).opacity).toBe("1");
  const t = await read(tip), ts = figma.ShortcutTooltip;
  ["top", "right", "bottom", "left"].forEach((s, i) => g.num(`padding-${s}`, ts.padding[i], t.padding[i]));
  g.num("gap", ts.gap, t.columnGap);
  g.num("radius", ts.radius, t.radius);
  g.color("fill", ts.fill, t.background);
  for (const [i, s] of ["top", "right", "bottom", "left"].entries()) g.stroke(`${s} edge`, i, ts.stroke, t);
  for (const [part, box] of [["label", t], ["key", await read(tip.locator("kbd"))]] as const) {
    const want = ts[part];
    g.color(`${part} colour`, want.token, box.color);
    const mono = box.family.toLowerCase().replace(/[\s_"-]/g, "").startsWith("geistmono") || box.family.toLowerCase().includes("mono");
    g.row(`${part} family`, want.family, box.family.split(",")[0], mono === (want.family === "Geist Mono"));
    g.row(`${part} weight`, String(want.weight), box.weight, box.weight === String(want.weight));
    g.num(`${part} size`, want.size, parseFloat(box.size));
    g.num(`${part} line-height`, want.lineHeight, parseFloat(box.lineHeight));
  }
  const tipText = (await tip.innerText()).replace(/\s+/g, " ").trim();
  g.row("text", "Comment C", tipText, tipText === "Comment C");
  await page.mouse.move(0, 0);

  g.at("Shortcuts");
  await page.keyboard.press("Control+c");
  await page.waitForTimeout(150);
  g.row("Ctrl+C still copies", "no composer", (await page.getByRole("dialog").isVisible()) ? "composer opened" : "no composer", !(await page.getByRole("dialog").isVisible()));
  await page.keyboard.press("e");
  const reactBar = page.getByRole("toolbar", { name: "Emoji reactions" });
  await expect(reactBar).toBeVisible();
  g.row("E opens the react bar", "open", "open", true);

  g.at("ReactBar");
  const r = await read(reactBar), rs = figma.ReactBar;
  g.num("height", rs.height, r.height);
  ["top", "right", "bottom", "left"].forEach((s, i) => g.num(`padding-${s}`, rs.padding[i], r.padding[i]));
  g.row("shape", "pill", r.radius >= r.height / 2 ? "pill" : `${r.radius}px`, r.radius >= r.height / 2);
  g.color("fill", rs.fill, r.background);
  for (const [i, s] of ["top", "right", "bottom", "left"].entries()) g.stroke(`${s} edge`, i, null, r);
  const emoji = await reactBar.getByRole("button", { name: /^React with / }).count();
  g.row("reactions", String(rs.emoji), String(emoji), emoji === rs.emoji);
  g.num("button", rs.button, (await read(reactBar.getByRole("button", { name: "Search emoji" }))).width);
  g.num("same place as the group", b.x, r.x);
  await page.keyboard.press("Escape");
  await expect(group).toBeVisible();

  g.at("Shortcuts");
  await page.keyboard.press("c");
  await expect(page.getByLabel("Comment as You")).toBeFocused();
  const quote = await page.locator(".comment-quote").innerText();
  g.row("C opens the composer on the selection", PHRASE, quote, quote.includes(PHRASE));
  const typed = await page.getByLabel("Comment as You").inputValue();
  g.row("the C is not typed", '""', JSON.stringify(typed), typed === "");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();

  g.at("SelectionGroup · Sized");
  const word = await page.locator(".prose [data-source-start]").filter({ hasText: CONTENT }).evaluate((element, phrase) => {
    const text = element.firstChild!, start = text.textContent!.indexOf(phrase) + 9;
    const range = document.createRange(); range.setStart(text, start); range.setEnd(text, start + 4);
    const rect = range.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }, PHRASE);
  await page.mouse.dblclick(word.x, word.y);
  await expect(page.getByRole("button", { name: "Smaller selection" })).toBeVisible({ timeout: 5000 });
  await g.order("order", spec.order.Sized, group);
  const d = await read(group.locator(".selection-divider"));
  g.num("divider width", spec.divider.width, d.width);
  g.num("divider height", spec.divider.height, d.height);
  g.color("divider", spec.divider.fill, d.background);
  g.num("size buttons", spec.button, (await read(group.getByRole("button", { name: "Smaller selection" }))).width);

  g.at("SelectionGroup · narrow window");
  await page.setViewportSize({ width: 800, height: 800 });
  await page.mouse.click(10, 10);
  await selectPhrase(page);
  await expect(group).toBeVisible();
  const n = await read(group);
  const last = await page.evaluate(() => Array.from(window.getSelection()!.getRangeAt(0).getClientRects()).sort((a, c) => c.bottom - a.bottom)[0].toJSON());
  g.num("below the last line", last.bottom + 8, n.y);
  g.row("inside the window", "yes", n.x + n.width <= 800 - 8 ? "yes" : `${n.x + n.width}px`, n.x >= 8 && n.x + n.width <= 800 - 8);
}

function report(rows: Row[], name: string) {
  const passed = rows.filter(r => r.pass).length;
  return [
    `# Figma ${name}: ${grade(passed / rows.length)} (${passed}/${rows.length})`,
    "",
    "| Scheme | Surface | Property | Expected (Figma) | Actual (app) | |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows.map(r => `| ${r.scheme} | ${r.surface} | ${r.property} | ${r.expected} | ${r.actual} | ${r.pass ? "pass" : "FAIL"} |`),
  ].join("\n");
}
async function finish(rows: Row[], name: string, info: { attach: (name: string, options: { body: string; contentType: string }) => Promise<void> }) {
  const text = report(rows, name);
  await info.attach(`figma-${name}.md`, { body: text, contentType: "text/markdown" });
  console.log(text.split("\n")[0]);
  for (const r of rows.filter(r => !r.pass)) console.log(`FAIL ${r.scheme} ${r.surface} · ${r.property}: want ${r.expected}, got ${r.actual}`);
  expect(rows.filter(r => !r.pass).length, text.split("\n")[0]).toBe(0);
}

test("desktop selection actions match the Figma components, property for property", async ({ page, request }, info) => {
  test.skip(info.project.name !== "chromium", "A desktop pointer and keyboard");
  test.setTimeout(120_000);
  const key = `selection-${Date.now()}`;
  await request.post("/api/content", { data: { key, content: CONTENT } });
  const rows: Row[] = [];
  for (const scheme of ["light", "dark"] as const) await desktop(page, scheme, rows, key);
  await finish(rows, "selection", info);
});

test("the phone selection bar matches the Figma component, property for property", async ({ page, request }, info) => {
  test.skip(info.project.name !== "iphone-webkit", "A touch screen");
  test.setTimeout(120_000);
  const key = `selection-phone-${Date.now()}`;
  await request.post("/api/content", { data: { key, content: CONTENT } });
  const rows: Row[] = [];
  for (const scheme of ["light", "dark"] as const) {
    const g = grader(rows, scheme);
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(`/?key=${key}&persist=1`);
    await expect(page.getByRole("button", { name: "Comments (0 open)" })).toBeVisible();
    g.at("SelectionBar · Default");
    await selectPhrase(page);
    const bar = page.locator(".selection-bar");
    await expect(bar).toBeVisible();
    const b = await read(bar), spec = figma.SelectionBar, view = page.viewportSize()!;
    g.num("height", spec.height, b.height);
    g.num("flush with the bottom", view.height, b.y + b.height);
    g.num("full width", view.width, b.width);
    g.num("padding-left", spec.padding[3], b.padding[3]);
    g.num("padding-right", spec.padding[1], b.padding[1]);
    g.color("fill", spec.fill, b.background);
    g.stroke("top rule", 0, spec.top, b);
    await g.order("order", spec.order.Default, bar);
    g.num("button", spec.button, (await read(bar.getByRole("button", { name: "Comment on selection" }))).width);
    g.at("SelectionBar · React");
    await bar.getByRole("button", { name: "React to selection" }).tap();
    const react = page.getByRole("toolbar", { name: "Emoji reactions" });
    await expect(react).toBeVisible();
    await g.order("order", spec.order.React, react);
    g.num("flush with the bottom", view.height, (await read(react)).y + (await read(react)).height);
    await react.getByRole("button", { name: "Back" }).tap();
    await expect(bar.getByRole("button", { name: "Comment on selection" })).toBeVisible();
    g.row("Back returns to the actions", "actions", "actions", true);
  }
  await finish(rows, "selection-phone", info);
});
