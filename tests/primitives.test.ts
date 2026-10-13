import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : [];
  });

// The primitives own their size and type (graded against Figma in figma-components.spec.ts);
// a call site may add layout (width, flex) but must not resize or restyle them.
const OVERRIDES = /\b(?:p[xytblr]?|h|min-h|text|rounded|border|bg|font)-[\w[\]./-]+/g;
const LAYOUT_OK = /^(?:(?:sm:)?(?:flex-1|w-full|w-auto)|min-w-0|shrink-0)$/;

test("Button and TextInput call sites add layout only", () => {
  const hits: string[] = [];
  for (const path of files("app")) {
    if (path.endsWith("controlStyles.ts")) continue;
    for (const [i, line] of readFileSync(path, "utf8").split("\n").entries()) {
      for (const use of line.matchAll(/`([^`]*)\$\{(?:primaryButtonClass|secondaryButtonClass|textInputClass)\([^)]*\)\}([^`]*)`/g)) {
        const extra = `${use[1]} ${use[2]}`.trim().split(/\s+/).filter(Boolean).filter(cls => !LAYOUT_OK.test(cls));
        const restyled = extra.filter(cls => cls.match(OVERRIDES));
        if (restyled.length) hits.push(`${path}:${i + 1} ${restyled.join(" ")}`);
      }
      if (/\$\{(?:primaryButtonClass|secondaryButtonClass|textInputClass)\}/.test(line)) hits.push(`${path}:${i + 1} uses a style without calling it`);
    }
  }
  assert.deepEqual(hits, []);
});

test("icon buttons come from the IconButton styles", () => {
  const toolbar = readFileSync("app/components/ToolbarButton.tsx", "utf8");
  assert.match(toolbar, /toolbarButtonClass = iconButtonClass;/);
  assert.match(toolbar, /toolbarButtonActiveClass = iconButtonPressedClass;/);
  assert.match(readFileSync("app/components/DeleteButton.tsx", "utf8"), /armedClass = iconButtonArmedClass;/);
});

test("tags use the tag classes, not the retired creator-tag ones", () => {
  const hits = files("app").filter(path => readFileSync(path, "utf8").includes("creator-tag"));
  assert.deepEqual(hits, []);
});
