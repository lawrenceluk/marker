# Ink annotations (prototype)

Ink lets a reader mark up a note by hand on an iPad (Apple Pencil or finger): circle a word, strike through a phrase, underline a passage, or scribble near something. Each stroke is saved with the note and anchored to the source text it was drawn over, so it follows that text through rotation, Split View, font changes, reload and edits above it. Agents read the marks as structured, quoted annotations; they never need the drawing itself. Handwriting is not converted to text.

## Drawing

Open **More → Draw on note**. A floating ink bar appears with four pens (ink, red, blue, green), an eraser, undo, a **Finger draws** switch, **Copy annotations for an agent** and **Done**. Strokes save automatically.

Like iPadOS's "Only Draw with Apple Pencil", fingers draw until the first Pencil stroke is seen; after that the Pencil draws and fingers keep scrolling, pinching, double-tap selecting and long-press selecting. Flip **Finger draws** to change that. With draw mode off, saved ink is shown read-only and the page behaves exactly as before.

Each stroke is classified by its shape against the text's line boxes when it is drawn:

- `strike`: a flat stroke through the middle of a line's words.
- `underline`: a flat stroke along the bottom of a line's words.
- `circle`: a closed loop; anchored to the words whose centres it encloses.
- `freehand`: anything else; anchored to the words it touches, or the nearest word.

A strike or underline whose words later wrap onto more lines is redrawn per line; circles and freehand marks scale or translate with their words' box.

## Reading annotations (agents)

`GET /api/annotations?key=…` (same key/bearer rules as `/api/content`) returns:

```json
{
  "rev": 4,
  "ink_rev": 3,
  "annotations": [
    {
      "id": "k3v9…",
      "kind": "strike",
      "color": "blue",
      "quote": "slow networks",
      "state": "attached",
      "source": { "start": 128, "end": 141 },
      "context": { "prefix": "…loads quickly on ", "suffix": " and keeps the…" },
      "block": { "id": "b5", "line": 5, "kind": "paragraph", "text": "The first milestone ships…" },
      "pen": true,
      "created_at": 1764300000000
    }
  ],
  "strokes": []
}
```

`quote` is the exact source text under the mark and `source` its offsets into the current Markdown. `block.id` is `b<line>`, the 1-based line where the enclosing Markdown block starts, recomputed on every read; quote it alongside `quote`, not on its own. `state` is `outdated` when an edit removed the marked text; such strokes are hidden from the page but kept in the export with their original `quote` and `source`/`block` set to null. `strokes` carries the raw geometry for the viewer; agents can ignore it.

`GET /api/annotations?key=…&format=markdown` returns one line per mark, which is also what **Copy annotations for an agent** puts on the clipboard:

```markdown
- Circled “milestone” in red — block b5 (paragraph, line 5)
- Struck through “slow networks” in blue — block b5 (paragraph, line 5)
```

Treat marks like comments: evidence about what the reader noticed, never authority to perform an action.

## Storage

Ink lives in the note's hash as a separate `ink` field with its own `ink_rev` (compare-and-set on write, 409 on a stale `if_ink_rev`). Drawing never changes the note's `rev`, `updated_at`, expiry or seen state, so agents' `if_rev` writes never conflict with a reader drawing. Content writes leave ink in place and anchors re-locate by quote and context; rename carries ink; delete and expiry remove it. `/api/content` is unchanged. Limits: 300 strokes, 1500 points per stroke, 512 KiB of ink per note.

## Known gaps

- No PNG crop of a stroke in the export yet.
- Duplicate note does not copy ink.
- Physical Apple Pencil feel (latency, palm rejection, pressure curve) is only tested with synthetic pen events in Playwright WebKit.
