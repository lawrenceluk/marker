import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/** Every .ts/.tsx/.css file under app/. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(tsx?|css)$/.test(name) ? [path] : [];
  });
}

// OG cards render on a fixed canvas outside the page theme, so they keep literal colours.
const OUTSIDE_THEME = /(^|\/)(og|opengraph-image|apple-icon)/;

test("components use the colour tokens, not raw Tailwind palette colours", () => {
  const raw = /\b(?:bg|text|border|ring|outline|fill|stroke|decoration|divide|placeholder|from|to|via)-(?:zinc|neutral|gray|slate|stone|red|blue|amber|yellow)-\d{2,3}\b|var\(--color-(?:zinc|blue|amber|yellow|red|gray|neutral)-\d{2,3}\)/g;
  const hits = sources("app")
    .filter(path => !OUTSIDE_THEME.test(path))
    .flatMap(path =>
      readFileSync(path, "utf8")
        .split("\n")
        .flatMap((line, i) => [...line.matchAll(raw)].map(match => `${path}:${i + 1} ${match[0]}`)),
    );
  assert.deepEqual(hits, [], "map these to tokens in app/globals.css (docs/typography.md)");
});

test("links take no colour of their own and H6 has no rule apart from H5", () => {
  const css = readFileSync("app/globals.css", "utf8");
  const link = css.match(/\.prose a \{([^}]*)\}/)![1];
  assert.match(link, /color:\s*inherit/);
  assert.match(link, /text-decoration-thickness:\s*1px/);
  assert.match(link, /text-underline-offset:\s*0\.2em/);
  assert.match(css.match(/\.prose a:hover \{([^}]*)\}/)![1], /^\s*text-decoration-thickness:\s*2px;\s*$/);
  // H6 may share H5's rules (`.prose h5, .prose h6 { … }`) but has none of its own.
  assert.doesNotMatch(css, /\}\s*(?:\/\*[\s\S]*?\*\/\s*)?\.prose h6\s*\{/);
});

test("embeds read the slab as --accent-ink and the accent as --red-new", () => {
  const embed = readFileSync("app/components/NoteEmbed.tsx", "utf8");
  assert.match(embed, /\["--accent-ink", "var\(--slab\)"\]/);
  assert.match(embed, /\["--red-new", "var\(--accent-new\)"\]/);
});
