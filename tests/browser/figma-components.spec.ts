import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import {
  iconButtonArmedClass,
  iconButtonClass,
  primaryButtonClass,
  secondaryButtonClass,
  textInputClass,
} from "../../app/components/controlStyles";

/**
 * Grades every variant of the four primitives against tests/fixtures/figma-components.json
 * (an export of Figma "Components (new)"), one node property per row, in light and dark.
 * Passes only at 100% (A+). Colours resolve through figma-tokens.json; type through its text styles.
 *
 * Strokes are graded as drawn: a transparent border reserves space but is no stroke.
 *
 * One deliberate difference: Figma draws focus as a 2px OUTSIDE stroke because it cannot offset
 * a stroke. Code follows the States recipe (2px ring at a 2px offset), so focus grades the ring's
 * width and colour, not its offset, and doesn't expect the resting border to disappear.
 */
type Rgba = { hex: string; alpha: number };
type TextSpec = { token: string; style: string; underline: boolean } | null;
type Spec = {
  height: number; width?: number; padding: { left: number; right: number }; radius: number;
  fill: string | null; stroke: { token: string; weight: number | Record<"top" | "right" | "bottom" | "left", number>; align: string } | null;
  opacity: number; label: TextSpec; labelGap?: number;
  count?: { fill: string; height: number; padding: number; radius: number; text: TextSpec };
  glyph?: { size: number; token: string };
};
const components: Record<string, Record<string, Spec>> = JSON.parse(readFileSync("tests/fixtures/figma-components.json", "utf8"));
const tokens: { color: Record<string, { light: Rgba; dark: Rgba }>; text: Record<string, { family: string; weight: number; size: number; lineHeight: number }> } =
  JSON.parse(readFileSync("tests/fixtures/figma-tokens.json", "utf8"));

/** How each Figma variant is rendered in code: markup, plus the interaction that puts it in its state. */
type Case = { html: string; state?: "hover" | "focus"; value?: string };
const glyph = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 10l9-7 9 7v10H3z"/></svg>';
function render(component: string, variant: string): Case {
  const prop = (name: string) => variant.match(new RegExp(`${name}=([^,]+)`))![1];
  if (component === "Button") {
    const cls = (prop("Kind") === "Primary" ? primaryButtonClass : secondaryButtonClass)(prop("Size") as "sm" | "md");
    const state = prop("State");
    return { html: `<button type="button" class="${cls}"${state === "Disabled" ? " disabled" : ""}><span>Save</span></button>`, state: state === "Hover" ? "hover" : state === "Focus" ? "focus" : undefined };
  }
  if (component === "IconButton") {
    const state = prop("State");
    const cls = state === "Armed" ? iconButtonArmedClass : iconButtonClass;
    return { html: `<button type="button" aria-label="Home" class="${cls}"${state === "Disabled" ? " disabled" : ""}>${glyph}</button>`, state: state === "Hover" ? "hover" : state === "Focus" ? "focus" : undefined };
  }
  if (component === "TextInput") {
    const font = prop("Font") === "Mono" ? "mono" : "sans";
    const state = prop("State");
    const placeholder = font === "mono" ? "Creator key" : "Folder name";
    const value = state === "Filled" || state === "Focus" ? (font === "mono" ? "MK-7Q2F-K9" : "Design notes") : undefined;
    return { html: `<input class="${textInputClass(font)}" placeholder="${placeholder}"${state === "Disabled" ? " disabled" : ""}>`, value, state: state === "Focus" ? "focus" : undefined };
  }
  const kind = prop("Kind"), state = prop("State");
  if (kind === "Small") return { html: '<span class="tag tag-small">design</span>' };
  if (kind === "Clear") return { html: '<a href="#clear" class="tag tag-clear">Clear</a>', state: state === "Hover" ? "hover" : undefined };
  return {
    html: `<button type="button" class="tag${state === "Selected" ? " tag-on" : ""}"><span class="tag-label">design</span> <span class="tag-count">4</span></button>`,
    state: state === "Hover" ? "hover" : state === "Focus" ? "focus" : undefined,
  };
}

type Measured = {
  height: number; width: number; paddingLeft: number; paddingRight: number; radius: number; background: string; opacity: number;
  border: Record<"top" | "right" | "bottom" | "left", { width: number; color: string }>; insetShadow: { width: number; color: string } | null;
  outline: { width: number; color: string; style: string };
  label: { color: string; family: string; weight: string; size: string; lineHeight: string; decoration: string } | null;
  labelGap: number | null;
  count: { background: string; height: number; paddingLeft: number; radius: number; color: string; family: string; weight: string; size: string; lineHeight: string } | null;
  glyph: { width: number; height: number; color: string } | null;
};

async function measure(page: Page, c: Case): Promise<Measured> {
  await page.evaluate(html => {
    document.getElementById("figma-stage")?.remove();
    const stage = document.createElement("div");
    stage.id = "figma-stage";
    stage.style.cssText = "position:fixed;left:40px;top:40px;z-index:9999;display:flex;gap:16px;align-items:center;width:360px;padding:16px;background:var(--background)";
    stage.innerHTML = `<button type="button" id="figma-before">before</button>${html}`;
    document.body.appendChild(stage);
  }, c.html);
  const target = page.locator("#figma-stage > :nth-child(2)");
  if (c.value !== undefined) {
    await target.fill(c.value);
    await target.blur();
  }
  await page.mouse.move(0, 0);
  if (c.state === "hover") await target.hover();
  if (c.state === "focus") {
    await page.locator("#figma-before").focus();
    await page.keyboard.press("Tab");
  }
  await page.waitForTimeout(220); // let colour transitions finish
  return target.evaluate(element => {
    const s = getComputedStyle(element), box = element.getBoundingClientRect();
    // A stroke is what's visible: a transparent border is no stroke (it only reserves space).
    const transparent = (c: string) => /^rgba\(.*,\s*0\)$|^transparent$|\/\s*0\)$/.test(c.replace(/\s+/g, " "));
    const side = (name: string) => {
      const color = s.getPropertyValue(`border-${name}-color`), width = parseFloat(s.getPropertyValue(`border-${name}-width`));
      return { width: transparent(color) ? 0 : width, color };
    };
    const layers = s.boxShadow === "none" ? [] : s.boxShadow.split(/,(?![^(]*\))/).map(layer => layer.trim());
    const inset = layers.map(layer => layer.match(/^(.*\))\s+0px\s+(-?\d+(?:\.\d+)?)px\s+0px(?:\s+0px)?\s+inset$/)).find(m => m && parseFloat(m[2]) !== 0 && !transparent(m[1]));
    const textOf = (el: Element | null, pseudo?: string) => {
      if (!el) return null;
      const t = getComputedStyle(el, pseudo);
      return { color: t.color, family: t.fontFamily, weight: t.fontWeight, size: t.fontSize, lineHeight: t.lineHeight, decoration: t.textDecorationLine };
    };
    const isInput = element instanceof HTMLInputElement;
    const label = isInput
      ? { ...textOf(element)!, color: getComputedStyle(element, element.value ? undefined : "::placeholder").color }
      : textOf(element.querySelector(".tag-label") ?? element.querySelector("span") ?? (element.childElementCount === 0 ? element : null));
    const labelEl = element.querySelector(".tag-label"), countEl = element.querySelector(".tag-count"), svg = element.querySelector("svg");
    const cs = countEl && getComputedStyle(countEl), cb = countEl?.getBoundingClientRect();
    return {
      height: box.height, width: box.width,
      paddingLeft: parseFloat(s.paddingLeft), paddingRight: parseFloat(s.paddingRight),
      radius: parseFloat(s.borderTopLeftRadius), background: s.backgroundColor, opacity: parseFloat(s.opacity),
      border: { top: side("top"), right: side("right"), bottom: side("bottom"), left: side("left") },
      insetShadow: inset ? { width: Math.abs(parseFloat(inset[2])), color: inset[1] } : null,
      outline: { width: parseFloat(s.outlineWidth), color: s.outlineColor, style: s.outlineStyle },
      label,
      labelGap: labelEl && cb ? cb.left - labelEl.getBoundingClientRect().right : null,
      count: cs && cb ? { background: cs.backgroundColor, height: cb.height, paddingLeft: parseFloat(cs.paddingLeft), radius: parseFloat(cs.borderTopLeftRadius), color: cs.color, family: cs.fontFamily, weight: cs.fontWeight, size: cs.fontSize, lineHeight: cs.lineHeight } : null,
      glyph: svg ? { width: svg.getBoundingClientRect().width, height: svg.getBoundingClientRect().height, color: getComputedStyle(svg).color } : null,
    };
  });
}

const rgba = (color: string) => {
  const n = color.match(/[\d.]+/g)!.map(Number);
  const rgb = color.startsWith("color(") ? n.slice(0, 3).map(c => Math.round(c * 255)) : n.slice(0, 3);
  return { rgb, alpha: n[3] ?? 1 };
};
const hex = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const sameColor = (actual: string, want: Rgba | "none") => {
  const a = rgba(actual);
  if (want === "none") return a.alpha === 0;
  return Math.abs(a.alpha - want.alpha) <= 0.01 && hex(want.hex).every((c, i) => Math.abs(c - a.rgb[i]) <= 1);
};
const showColor = (c: string) => { const a = rgba(c); return a.alpha === 0 ? "none" : `rgb(${a.rgb.join(",")})${a.alpha < 1 ? ` / ${+a.alpha.toFixed(2)}` : ""}`; };
const showToken = (name: string | null, want: Rgba | "none") => (name ? `${name} ${want === "none" ? "" : `${want.hex}${want.alpha < 1 ? ` / ${want.alpha}` : ""}`}` : "none");
const grade = (score: number) => (score === 1 ? "A+" : score >= 0.97 ? "A" : score >= 0.9 ? "A-" : score >= 0.8 ? "B" : "C");

type Row = { scheme: string; component: string; variant: string; property: string; expected: string; actual: string; pass: boolean };

test("primitives match the Figma components, property for property", async ({ page }, info) => {
  test.skip(info.project.name !== "chromium", "Hover and keyboard focus states are graded on desktop Chromium");
  test.setTimeout(180_000);
  const rows: Row[] = [];
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Marker", exact: true })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const token = (name: string | null): Rgba | "none" => (name ? tokens.color[name][scheme] : "none");

    for (const [component, variants] of Object.entries(components)) {
      if (component === "source") continue;
      for (const [variant, spec] of Object.entries(variants)) {
        const got = await measure(page, render(component, variant));
        const row = (property: string, expected: string, actual: string, pass: boolean) =>
          rows.push({ scheme, component, variant, property, expected, actual, pass });
        const near = (a: number, b: number, tolerance = 0.5) => Math.abs(a - b) <= tolerance;
        const typeRows = (prefix: string, want: TextSpec, have: Measured["label"] | Measured["count"]) => {
          if (!want) return;
          if (!have) return row(prefix, want.style, "(missing)", false);
          const style = tokens.text[want.style];
          row(`${prefix} colour`, showToken(want.token, token(want.token)), showColor(have.color), sameColor(have.color, token(want.token)));
          const face = have.family.split(",")[0].replace(/"/g, "").toLowerCase().replace(/[\s_-]/g, "");
          row(`${prefix} family`, style.family, have.family.split(",")[0], face.startsWith("geist") && face.startsWith("geistmono") === (style.family === "Geist Mono"));
          row(`${prefix} weight`, String(style.weight), have.weight, have.weight === String(style.weight));
          row(`${prefix} size`, `${style.size}px`, have.size, have.size === `${style.size}px`);
          row(`${prefix} line-height`, `${style.lineHeight}px`, have.lineHeight, near(parseFloat(have.lineHeight), style.lineHeight));
          if ("decoration" in have) row(`${prefix} underline`, String(want.underline), String(have.decoration.includes("underline")), have.decoration.includes("underline") === want.underline);
        };

        row("height", `${spec.height}px`, `${got.height}px`, near(got.height, spec.height));
        if (spec.width !== undefined) row("width", `${spec.width}px`, `${got.width}px`, near(got.width, spec.width));
        row("padding-left", `${spec.padding.left}px`, `${got.paddingLeft}px`, near(got.paddingLeft, spec.padding.left));
        row("padding-right", `${spec.padding.right}px`, `${got.paddingRight}px`, near(got.paddingRight, spec.padding.right));
        const pill = spec.radius >= spec.height / 2;
        row("radius", pill ? "pill" : `${spec.radius}px`, got.radius >= got.height / 2 ? "pill" : `${got.radius}px`, pill ? got.radius >= got.height / 2 : near(got.radius, spec.radius));
        row("fill", showToken(spec.fill, token(spec.fill)), showColor(got.background), sameColor(got.background, token(spec.fill)));
        row("opacity", String(spec.opacity), String(got.opacity), near(got.opacity, spec.opacity, 0.01));

        const ring = spec.stroke?.token === "focus/ring" && typeof spec.stroke.weight === "number" ? spec.stroke.weight : null;
        if (ring !== null) {
          // A uniform focus stroke is the focus ring (an outline in code).
          const width = got.outline.style === "none" ? 0 : got.outline.width;
          row("focus ring width", `${ring}px`, `${width}px`, near(width, ring));
          row("focus ring colour", showToken("focus/ring", token("focus/ring")), showColor(got.outline.color), sameColor(got.outline.color, token("focus/ring")));
        } else {
          // A per-side stroke is a border; an underline input's focus adds an inset shadow on top of it.
          const want = spec.stroke ? (typeof spec.stroke.weight === "number" ? { top: spec.stroke.weight, right: spec.stroke.weight, bottom: spec.stroke.weight, left: spec.stroke.weight } : spec.stroke.weight) : { top: 0, right: 0, bottom: 0, left: 0 };
          for (const side of ["top", "right", "bottom", "left"] as const) {
            const extra = side === "bottom" && got.insetShadow ? got.insetShadow.width : 0;
            const width = got.border[side].width + extra;
            row(`stroke ${side}`, `${want[side]}px`, `${width}px`, near(width, want[side]));
            if (want[side] > 0) {
              row(`stroke ${side} colour`, showToken(spec.stroke!.token, token(spec.stroke!.token)), showColor(got.border[side].color), sameColor(got.border[side].color, token(spec.stroke!.token)));
              if (extra) row(`stroke ${side} colour (inset)`, showToken(spec.stroke!.token, token(spec.stroke!.token)), showColor(got.insetShadow!.color), sameColor(got.insetShadow!.color, token(spec.stroke!.token)));
            }
          }
        }
        typeRows("label", spec.label, got.label);
        if (spec.labelGap !== undefined) row("label→count gap", `${spec.labelGap}px`, `${got.labelGap}px`, got.labelGap !== null && near(got.labelGap, spec.labelGap));
        if (spec.count) {
          const c = got.count;
          row("count fill", showToken(spec.count.fill, token(spec.count.fill)), c ? showColor(c.background) : "(missing)", !!c && sameColor(c.background, token(spec.count.fill)));
          row("count height", `${spec.count.height}px`, c ? `${c.height}px` : "(missing)", !!c && near(c.height, spec.count.height));
          row("count padding", `${spec.count.padding}px`, c ? `${c.paddingLeft}px` : "(missing)", !!c && near(c.paddingLeft, spec.count.padding));
          row("count radius", "pill", c ? (c.radius >= c.height / 2 ? "pill" : `${c.radius}px`) : "(missing)", !!c && c.radius >= c.height / 2);
          typeRows("count", spec.count.text, c);
        }
        if (spec.glyph) {
          const g = got.glyph;
          row("glyph size", `${spec.glyph.size}px`, g ? `${g.width}×${g.height}px` : "(missing)", !!g && near(g.width, spec.glyph.size) && near(g.height, spec.glyph.size));
          row("glyph colour", showToken(spec.glyph.token, token(spec.glyph.token)), g ? showColor(g.color) : "(missing)", !!g && sameColor(g.color, token(spec.glyph.token)));
        }
      }
    }
  }

  const passed = rows.filter(r => r.pass).length, score = passed / rows.length;
  const failing = rows.filter(r => !r.pass);
  const report = [
    `# Figma components: ${grade(score)} (${passed}/${rows.length})`,
    "",
    "| Scheme | Component | Variant | Property | Expected (Figma) | Actual (code) | |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map(r => `| ${r.scheme} | ${r.component} | ${r.variant} | ${r.property} | ${r.expected} | ${r.actual} | ${r.pass ? "pass" : "FAIL"} |`),
  ].join("\n");
  await info.attach("figma-components.md", { body: report, contentType: "text/markdown" });
  console.log(report.split("\n")[0]);
  for (const r of failing.slice(0, 60)) console.log(`FAIL ${r.scheme} ${r.component} [${r.variant}] ${r.property}: want ${r.expected}, got ${r.actual}`);
  expect(failing.length, report.split("\n")[0]).toBe(0);
});

test("live call sites render the primitives at their Figma sizes", async ({ page, request }, info) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Marker", exact: true })).toBeVisible();
  const random = page.getByRole("button", { name: "New random note" });
  expect((await random.boundingBox())!.height).toBe(48);

  const key = `primitives-${info.project.name}-${Date.now()}`;
  await request.post("/api/content", { data: { key, content: "# Primitives" } });
  await page.goto(`/?key=${key}&persist=1`);
  const nav = page.getByRole("navigation", { name: "Note actions" });
  await expect(nav.getByRole("button")).toHaveCount(5);
  for (const button of await nav.getByRole("button").all()) {
    const box = (await button.boundingBox())!;
    expect([box.width, box.height]).toEqual([48, 48]);
    const glyph = (await button.locator("svg").first().boundingBox())!;
    expect([glyph.width, glyph.height]).toEqual([20, 20]);
  }
});
