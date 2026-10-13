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
| H5 | 14 / 20 | 600 | |
| H6 | 14 / 20 | 600 | `--muted` colour |

## Colour tokens used by text

| Token | Light | Dark |
| --- | --- | --- |
| `--muted` | 70% foreground | 70% foreground |
| `--danger` | #b91c1c (red-700) | #f87171 (red-400) |
| `--danger-surface` | 8% `--danger` on background | 8% `--danger` on background |
| `--code-background` / `--code-foreground` | zinc-100 / zinc-900 | zinc-800 / zinc-200 |

`--danger` text stays above 4.5:1 on the background, on `--danger-surface` and
on the 15% hover tint. Code passes AA by a wide margin in both schemes
(16.1:1 light, 11.7:1 dark).
