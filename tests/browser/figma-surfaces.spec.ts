import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Grades Marker's live surfaces against tests/fixtures/figma-surfaces.json (exported from Figma
 * "Components (new)") in light and dark. The app is driven into each state (menus open, the delete
 * row armed, the comment popover and phone sheet, the update pill, the error banner) and each node
 * property becomes one row. Passes only at 100% (A+). Strokes are graded as drawn (a transparent
 * border is no stroke).
 */
type Rgba = { hex: string; alpha: number };
const tokens: { color: Record<string, { light: Rgba; dark: Rgba }>; text: Record<string, { family: string; weight: number; size: number; lineHeight: number }> } =
  JSON.parse(readFileSync("tests/fixtures/figma-tokens.json", "utf8"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const figma: any = JSON.parse(readFileSync("tests/fixtures/figma-surfaces.json", "utf8"));

type Row = { scheme: string; surface: string; property: string; expected: string; actual: string; pass: boolean };
type Box = {
  width: number; height: number; padding: number[]; radius: number; background: string; boxShadow: string; gap: number;
  border: { width: number; color: string }[]; color: string; family: string; weight: string; size: string; lineHeight: string; decoration: string;
  left: number; top: number; right: number; bottom: number;
};

const read = (locator: Locator, pseudo?: string): Promise<Box> =>
  locator.first().evaluate((element, pseudo) => {
    const s = getComputedStyle(element, pseudo), r = element.getBoundingClientRect();
    const side = (n: string) => ({ width: parseFloat(s.getPropertyValue(`border-${n}-width`)), color: s.getPropertyValue(`border-${n}-color`) });
    return {
      // A pseudo-element has no box of its own to measure; use its computed size.
      width: pseudo ? parseFloat(s.width) : r.width, height: pseudo ? parseFloat(s.height) : r.height, left: r.left, top: r.top, right: r.right, bottom: r.bottom,
      padding: [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft].map(parseFloat),
      radius: parseFloat(s.borderTopLeftRadius), background: s.backgroundColor, boxShadow: s.boxShadow, gap: parseFloat(s.columnGap) || parseFloat(s.rowGap) || 0,
      border: ["top", "right", "bottom", "left"].map(side),
      color: s.color, family: s.fontFamily, weight: s.fontWeight, size: s.fontSize, lineHeight: s.lineHeight, decoration: s.textDecorationLine,
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

async function suite(page: Page, scheme: "light" | "dark", rows: Row[], fixtures: { folderToken: string; noteKey: string; commentKey: string }) {
  const tok = (name: string | null) => (name ? tokens.color[name][scheme] : null);
  const same = (actual: string, name: string | null) => {
    const want = tok(name), a = channels(actual);
    if (!want) return a.alpha === 0;
    return Math.abs(a.alpha - want.alpha) <= 0.01 && hex(want.hex).every((c, i) => Math.abs(c - a.rgb[i]) <= 1);
  };
  const wantText = (name: string | null) => (name ? `${name} ${tok(name)!.hex}${tok(name)!.alpha < 1 ? ` / ${tok(name)!.alpha}` : ""}` : "none");
  let surface = "";
  const row = (property: string, expected: string, actual: string, pass: boolean) => rows.push({ scheme, surface, property, expected, actual, pass });
  const near = (a: number, b: number, t = 0.5) => Math.abs(a - b) <= t;
  const num = (property: string, want: number, got: number, t = 0.5) => row(property, `${want}px`, `${+got.toFixed(2)}px`, near(got, want, t));
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
  const pad = (want: number[], got: Box) => ["top", "right", "bottom", "left"].forEach((s, i) => num(`padding-${s}`, want[i], got.padding[i]));
  const noShadow = (got: Box) => row("shadow", "none", got.boxShadow, got.boxShadow === "none");

  await page.emulateMedia({ colorScheme: scheme });
  await page.setViewportSize({ width: 1280, height: 900 });

  // ---- Lists: Home's remembered folders.
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Folders" })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  surface = "List";
  const list = page.locator(".list").first();
  stroke("top rule", 0, figma.List.top, await read(list));
  surface = "ListRow · folder";
  const folderRow = list.locator(".list-row").first();
  const r = await read(folderRow);
  row("min-height", `≥${figma.ListRow.minHeight}px`, `${r.height}px`, r.height >= figma.ListRow.minHeight - 0.5);
  num("gap", figma.ListRow.gap, r.gap);
  stroke("bottom rule", 2, figma.ListRow.bottom, r);
  type("title", figma.ListRow.title, await read(folderRow.locator(".list-title")));
  type("meta", figma.ListRow.meta, await read(folderRow.locator(".list-meta")));
  const more = await read(folderRow.getByRole("button"));
  num("more width", figma.ListRow.more.width, more.width);
  num("more height", figma.ListRow.more.height, more.height);
  await folderRow.locator(".list-link").hover();
  await page.waitForTimeout(200);
  color("hover bottom rule colour", figma.ListRow.hoverBottom, (await read(folderRow)).border[2].color);
  await page.mouse.move(0, 0);

  // ---- Lists: a folder's notes, and its error banner.
  await page.goto(`/c?token=${fixtures.folderToken}`);
  await expect(page.locator(".list .list-row").first()).toBeVisible();
  surface = "ListRow · note";
  const noteRow = page.locator(".list .list-row").first();
  const nr = await read(noteRow);
  row("min-height", `≥${figma.ListRow.minHeight}px`, `${nr.height}px`, nr.height >= figma.ListRow.minHeight - 0.5);
  stroke("bottom rule", 2, figma.ListRow.bottom, nr);
  type("title", figma.ListRow.title, await read(noteRow.locator(".list-title")));
  type("meta", figma.ListRow.meta, await read(noteRow.locator(".list-meta")));
  await page.goto("/c?error=not_found");
  surface = "Banner · error";
  const banner = await read(page.getByRole("alert"));
  pad(figma.Banner.error.padding, banner);
  stroke("top rule", 0, figma.Banner.error.top, banner);
  color("fill", null, banner.background);
  type("text", figma.Banner.error.text, banner);

  // ---- Note: header, badge, menus, switch, preview banner.
  await page.goto(`/?key=${fixtures.commentKey}&persist=1`);
  const nav = page.getByRole("navigation", { name: "Note actions" });
  await expect(nav.getByRole("button", { name: /^Comments \(1 open\)/ })).toBeVisible();
  surface = "Header";
  const header = await read(nav);
  num("height", figma.Header.height, header.height);
  stroke("bottom rule", 2, figma.Header.bottom, header);
  for (const button of await nav.getByRole("button").all()) {
    const b = await read(button);
    num(`${await button.getAttribute("aria-label")} size`, figma.Header.button, Math.max(b.width, b.height));
  }
  surface = "Badge";
  const comments = nav.getByRole("button", { name: /^Comments/ });
  const badge = await read(comments.locator(".comment-count")), host = await read(comments);
  num("height", figma.Badge.height, badge.height);
  row("min-width", `≥${figma.Badge.minWidth}px`, `${badge.width}px`, badge.width >= figma.Badge.minWidth - 0.5);
  num("padding-left", figma.Badge.padding[3], badge.padding[3]);
  num("padding-right", figma.Badge.padding[1], badge.padding[1]);
  row("radius", "pill", badge.radius >= badge.height / 2 ? "pill" : `${badge.radius}px`, badge.radius >= badge.height / 2);
  color("fill", figma.Badge.fill, badge.background);
  type("count", figma.Badge.text, badge);
  num("offset right", figma.Badge.offset.right, host.right - badge.right);
  num("offset top", figma.Badge.offset.top, badge.top - host.top);

  surface = "Banner · preview";
  const aside = page.locator("aside").first();
  if (await aside.count()) {
    const a = await read(aside);
    color("fill", figma.Banner.preview.fill, a.background);
    color("text", figma.Banner.preview.text, a.color);
    color("action", figma.Banner.preview.action, (await read(aside.locator("a"))).color);
  }

  surface = "Menu · more";
  await nav.getByRole("button", { name: "More" }).click();
  const menu = page.getByRole("dialog", { name: "More options" });
  await expect(menu).toBeVisible();
  const m = await read(menu);
  num("width", figma.Menu.width, m.width);
  pad(figma.Menu.padding, m);
  num("radius", figma.Menu.radius, m.radius);
  color("fill", figma.Menu.fill, m.background);
  for (const [i, s] of ["top", "right", "bottom", "left"].entries()) stroke(`${s} edge`, i, figma.Menu.border, m);
  noShadow(m);
  const rule = await read(menu.locator(".toolbar-menu-rule"));
  num("rule height", figma.Menu.rule.height, rule.height);
  color("rule colour", figma.Menu.rule.token, rule.background);
  num("rule inset", figma.Menu.rule.marginX, rule.left - m.left - m.border[3].width);
  surface = "MenuRow";
  const item = menu.locator(".toolbar-menu-item").first();
  const it = await read(item);
  num("height", figma.MenuRow.height, it.height);
  pad(figma.MenuRow.padding, it);
  num("gap", figma.MenuRow.gap, it.gap);
  type("label", figma.MenuRow.label, it);
  const icon = await read(item.locator("svg"));
  num("icon size", figma.MenuRow.icon.size, icon.width);
  color("icon colour", figma.MenuRow.icon.token, icon.color);
  await item.hover();
  await page.waitForTimeout(220);
  color("hover fill", figma.MenuRow.hover.fill, (await read(item)).background);
  color("hover icon", figma.MenuRow.hover.icon, (await read(item.locator("svg"))).color);
  surface = "MenuRow · danger armed";
  const del = menu.getByRole("button", { name: "Delete note" });
  await del.click();
  const armed = menu.getByRole("button", { name: "Press again to delete note" });
  await expect(armed).toBeVisible();
  await page.mouse.move(0, 0);
  await page.waitForTimeout(220);
  color("label", figma.MenuRow.armed.label, (await read(armed)).color);
  color("icon", figma.MenuRow.armed.icon, (await read(armed.locator("svg"))).color);
  await page.keyboard.press("Escape");

  surface = "Switch";
  await nav.getByRole("button", { name: "Share" }).click();
  const toggle = page.getByRole("switch", { name: "Persistent link" });
  await expect(toggle).toBeVisible();
  for (const state of ["on", "off"] as const) {
    if (state === "off") await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", state === "on" ? "true" : "false");
    await page.waitForTimeout(220);
    const sw = toggle.locator(".switch"), body = await read(sw), knob = await read(sw, "::after");
    num(`${state} width`, figma.Switch.width, body.width);
    num(`${state} height`, figma.Switch.height, body.height);
    row(`${state} radius`, "pill", body.radius >= body.height / 2 ? "pill" : `${body.radius}px`, body.radius >= body.height / 2);
    num(`${state} knob`, figma.Switch.knob, parseFloat(String(knob.width)));
    if (state === "on") { color("on fill", figma.Switch.on.fill, body.background); color("on knob", figma.Switch.on.knob, knob.background); }
    else { color("off fill", null, body.background); color("off edge", figma.Switch.off.border, body.border[0].color); color("off knob", figma.Switch.off.knob, knob.background); }
  }
  await toggle.click();
  await page.keyboard.press("Escape");

  // ---- Comment popover: list, a row, the thread.
  surface = "CommentSheet · popover";
  await comments.click();
  const sheet = page.locator(".comment-sheet");
  await expect(sheet).toBeVisible();
  const sh = await read(sheet), sp = figma.CommentSheet.popover;
  num("width", sp.width, sh.width);
  pad(sp.padding, sh);
  num("radius", sp.radius, sh.radius);
  color("fill", sp.fill, sh.background);
  for (const [i, s] of ["top", "right", "bottom", "left"].entries()) stroke(`${s} edge`, i, { token: sp.border.token, width: sp.border.width[i] }, sh);
  noShadow(sh);
  num("header height", sp.header, (await read(sheet.locator(".comment-heading"))).height);
  num("close size", sp.icon, (await read(sheet.getByRole("button", { name: "Close" }))).width);
  surface = "CommentRow";
  const crow = sheet.locator(".comment-row").first();
  const cr = await read(crow);
  pad(figma.CommentRow.padding, cr);
  num("gap", figma.CommentRow.gap, cr.gap);
  stroke("bottom rule", 2, figma.CommentRow.bottom, cr);
  type("anchor", figma.CommentRow.anchor, await read(crow.locator(".comment-anchor")));
  type("body", figma.CommentRow.body, await read(crow.locator(".comment-body")));
  surface = "CommentSheet · thread";
  await crow.click();
  await expect(sheet.getByLabel("Reply as You")).toBeVisible();
  type("anchor", sp.anchor, await read(sheet.locator(".comment-quote")));
  type("author", figma.CommentSheet.thread.author, await read(sheet.locator(".comment-author").first()));
  type("message", figma.CommentSheet.thread.message, await read(sheet.locator(".comment-text").first()));
  num("message gap", figma.CommentSheet.thread.messageGap, (await read(sheet.locator(".comment-thread-body"))).gap);
  const compose = await read(sheet.getByLabel("Reply as You"));
  await page.keyboard.press("Tab");
  const blurred = await read(sheet.getByLabel("Reply as You"));
  row("compose height", `≥${figma.CommentSheet.thread.compose.height}px`, `${compose.height}px`, compose.height >= figma.CommentSheet.thread.compose.height - 0.5);
  stroke("compose underline", 2, figma.CommentSheet.thread.compose.bottom, blurred);
  type("compose text", { style: figma.CommentSheet.thread.compose.style, token: "text/ink" }, blurred);
  color("compose placeholder", figma.CommentSheet.thread.compose.placeholder, (await read(sheet.getByLabel("Reply as You"), "::placeholder")).color);
  await sheet.getByRole("button", { name: "Close" }).click();

  // ---- Update pill.
  surface = "UpdateNudge";
  const revision = page.waitForResponse(response => response.url().includes("/api/revision"));
  await page.request.post("/api/content", { data: { key: fixtures.commentKey, content: "\n\nAn agent edit.", mode: "append" } });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await revision;
  const nudge = page.getByRole("button", { name: "Note updated · Refresh", exact: true });
  await expect(nudge).toBeVisible();
  const n = await read(nudge), un = figma.UpdateNudge;
  num("height", un.height, n.height);
  pad(un.padding, n);
  row("radius", "pill", n.radius >= n.height / 2 ? "pill" : `${n.radius}px`, n.radius >= n.height / 2);
  color("fill", un.default.fill, n.background);
  type("label", un.default.text, n);
  noShadow(n);
  await nudge.evaluate(element => { element.setAttribute("aria-busy", "true"); });
  await page.waitForTimeout(50);
  const busy = await read(nudge);
  color("refreshing fill", un.refreshing.fill, busy.background);
  color("refreshing label", un.refreshing.text.token, busy.color);

  // ---- Phone: the comment bottom sheet.
  surface = "CommentSheet · bottom sheet";
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/?key=${fixtures.commentKey}&persist=1`);
  await page.getByRole("navigation", { name: "Note actions" }).getByRole("button", { name: /^Comments/ }).click();
  await expect(sheet).toBeVisible();
  const bs = await read(sheet), ss = figma.CommentSheet.sheet;
  num("left", 0, bs.left);
  num("width", 390, bs.width);
  pad([ss.padding[0], ss.padding[1], Math.max(ss.padding[2], bs.padding[2]), ss.padding[3]], bs);
  color("fill", ss.fill, bs.background);
  for (const [i, s] of ["top", "right", "bottom", "left"].entries()) stroke(`${s} edge`, i, { token: ss.border.token, width: ss.border.width[i] }, bs);
  color("backdrop", ss.backdrop, (await read(sheet, "::backdrop")).background);
  await sheet.getByRole("button", { name: "Close" }).click();
}

test("surfaces match the Figma components, property for property", async ({ page, request }, info) => {
  test.skip(info.project.name !== "chromium", "States are driven with a desktop pointer; the phone sheet is graded at 390px");
  test.setTimeout(240_000);
  const stamp = Date.now();
  const created = await (await request.post("/api/content", { data: { key: `surfaces-a-${stamp}`, content: "# Release checklist", creator_id: true, creator_name: "Design notes", tags: ["planning"] } })).json();
  const folderToken = created.creator_id as string;
  await request.post("/api/content", { data: { key: `surfaces-b-${stamp}`, content: "# Q3 planning notes", creator_id: folderToken, tags: ["planning", "q3"] } });
  const commentKey = `surfaces-c-${stamp}`, body = "# Q3 planning notes\n\nWe want to ship the folder view before Friday.";
  await request.post("/api/content", { data: { key: commentKey, content: body } });
  const start = body.indexOf("the folder view");
  const rev = (await (await request.get(`/api/content?key=${commentKey}`)).json()).rev;
  await request.post("/api/comments", { data: { key: commentKey, if_rev: rev, operations: [{ action: "create", start, end: start + "the folder view before Friday".length, text: "Should this ship before the API limits land?" }] } });
  // Remember the folder so Home lists it.
  await page.goto(`/c?token=${folderToken}`);
  await expect(page.locator(".list .list-row").first()).toBeVisible();

  const rows: Row[] = [];
  for (const scheme of ["light", "dark"] as const) await suite(page, scheme, rows, { folderToken, noteKey: `surfaces-b-${stamp}`, commentKey });

  const passed = rows.filter(r => r.pass).length, score = passed / rows.length;
  const report = [
    `# Figma surfaces: ${grade(score)} (${passed}/${rows.length})`,
    "",
    "| Scheme | Surface | Property | Expected (Figma) | Actual (app) | |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows.map(r => `| ${r.scheme} | ${r.surface} | ${r.property} | ${r.expected} | ${r.actual} | ${r.pass ? "pass" : "FAIL"} |`),
  ].join("\n");
  await info.attach("figma-surfaces.md", { body: report, contentType: "text/markdown" });
  console.log(report.split("\n")[0]);
  for (const r of rows.filter(r => !r.pass)) console.log(`FAIL ${r.scheme} ${r.surface} · ${r.property}: want ${r.expected}, got ${r.actual}`);
  expect(rows.filter(r => !r.pass).length, report.split("\n")[0]).toBe(0);
});
