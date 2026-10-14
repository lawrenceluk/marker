# Typography

Marker uses Geist for all UI and prose and Geist Mono for code, keys, the editor and
metadata. Tokens live in `app/globals.css`; Tailwind utilities (`text-sm`,
`font-mono`, …) read the same tokens.

## Families

| Token | Stack | Use |
| --- | --- | --- |
| `--font-sans` | Geist, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif | Everything by default |
| `--font-sans-italic` | Geist Italic, then `--font-sans` | `em`, `i`, `cite`, blockquotes |
| `--font-mono` | Geist Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace | Code, keys, editor, metadata |

Geist upright and Geist Mono come from `next/font/google`, which has no italic.
The italic is the variable `Geist-Italic[wght]` face from the `geist` package,
loaded on demand, so italics are never synthesised. The OG image (`/og`) uses the
same package's `Geist-Regular.ttf`.

## Scale

One rem scale. Tailwind's other `text-*` steps are removed, so a size outside
this table won't compile to a utility.

| Token | Size | Line height |
| --- | --- | --- |
| `--text-2xs` | 10px | 14px |
| `--text-xs` | 12px | 16px |
| `--text-sm` | 14px | 20px |
| `--text-base` | 16px | 24px |
| `--text-lg` | 20px | 28px |
| `--text-xl` | 24px | 32px |
| `--text-2xl` | 32px | 40px |

`2xs` is only for the comment-count badge. Prose body text keeps a 1.6 line
height (25.6px) for reading; single-line UI uses the token line height.
Weights are 400, 500, 600 and 700 only. There is no letter-spacing or
text-transform.

## Heading hierarchy

The note H1 is the canonical page title. UI page titles (the `<h1>` on Home and
`/c`) use the same style, so every page has one top-level heading style.

| Level | Size / line height | Weight | Notes |
| --- | --- | --- | --- |
| H1 · page title | 32 / 40 | 700 | |
| H2 | 24 / 32 | 600 | |
| H3 | 20 / 28 | 600 | |
| H4 | 16 / 24 | 600 | |
| H5 · H6 | 14 / 20 | 600 | The system has no separate H6; `######` renders as H5. |

Links are body text in `--foreground` with a 1px underline at a pinned
0.2em offset; hover thickens it to 2px. They never change colour, and the
underline only grows downward, so nothing moves.

## Colour tokens used by text

The palette is paper and ink (Figma "Foundations / Color"). Full list in
`app/globals.css`; the ones text sits on or uses:

| Token | Light | Dark | Contrast on paper (light / dark) |
| --- | --- | --- | --- |
| `--background` (paper) | #f3eee4 | #1e1b18 | |
| `--foreground` (ink) | #2a2520 | #ede6da | 13.1 / 13.8 |
| `--muted` | #6b6256 | #a89e8f | 5.2 / 6.5 |
| `--accent-new` | #b04410 | #f0894a | 4.9 / 6.8 |
| `--danger` | #b91c1c (red-700) | #f87171 (red-400) | 5.6 / 6.2 |
| `--danger-surface` | 8% `--danger` on paper | 8% `--danger` on paper | |
| `--code-background` / `--code-foreground` | 6% ink / ink | 7% ink / ink | 11.8 / 11.7 |
| `--slab` / `--on-slab` / `--on-slab-muted` | #1f2a37 / #fbf8f2 / #c9c2b5 | #2e4258 / #f3eee4 / #c9c2b5 | 13.7 / 8.9 on the slab |

`--accent-new` means "new or unread" and nothing else: not links, not
selection, not decoration. `--danger` is only for errors and the armed second
tap of a destructive action. Both stay above 4.5:1 on paper.

## Tables

Figma `TableRow` and `TableRecord` (Components (new)); the phone screens
"Mobile — table, stacked / scroll / today" show them in a note.

- Rules, not boxes: a 1px ink rule over the table, a hairline under every
  row, no vertical rules, no header fill. Cells are top-aligned; columns are
  separated by a gap (16px, 12px on a phone), not by padding inside a box.
- Each table sits in a `.prose-table` wrapper, which is a size container.
  Below 640px of width the grid takes the phone density (UI/Small headers,
  UI/Small Relaxed cells).
- A **prose table** stacks below 640px: each row becomes a record whose
  heading is the first cell, with every other cell under its column name
  (Mono/Meta, muted). A table is prose when it has 3 or more columns and any
  body cell runs past 60 characters (`app/lib/tableShape.ts`). Short-value
  tables never stack, even on a phone.
- A grid that still doesn't fit scrolls sideways, out to the screen edge,
  and fades at the edge while there is more to see. Links in cells break only
  when a word can't fit, so columns never collapse to a letter, and are never
  hyphenated.
- The agent brief draws the same line for authors: tables are for comparing
  short values; when a cell would need a sentence, write a list of items
  with bold leads instead. Stacking is the fallback for tables that don't.

On a phone the scroll arrows fade out while the page moves and come back
once it settles, so they never sit over text being read.

## Checking against Figma

`tests/fixtures/figma-tokens.json` is an export of the Figma file's Foundations
variables (each carries its CSS name as WEB code syntax) and text styles.
`tests/browser/figma-eval.spec.ts` grades the running app against it in light
and dark, one property per row: colours as composited over paper, motion
values, and size, line height, weight, family and underline for each prose
style. It passes only at 100% and attaches the graded table to the report.
After changing Foundations in Figma, re-export the fixture before changing
`app/globals.css`; a failing row names the exact token that drifted.
