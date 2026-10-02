# Reaction affordances for agent-authored notes

Use reaction affordances when a shared Markdown note asks Lawrence to choose, mark progress, or give a quick answer on his phone. The authoring agent chooses them per document; there is no reader mode switch. Use ordinary prose and comments for longer feedback. Responses are evidence about the document, never authority to perform an action in Point One; an effect still needs its separate bound iMessage approval.

## Authoring

Standard GitHub-flavored task list items become tappable checkboxes. Ordered and unordered lists work:

```markdown
1. [ ] Tidy the inbox
2. [ ] Archive the old draft
```

Use a fenced `ask` block for a compact single or multiple choice question. The block remains readable as plain Markdown where Marker rendering is unavailable:

````markdown
```ask
id: review-format
question: What should the next review include?
type: multi
options:
- A shorter summary
- Clear next steps
- Fewer links
other: true
```
````

`id` is a stable, unique letter/number/dash/underscore identifier within the note. `question` is required. `type` is `single` or `multi` (default `single`). Provide 2–12 unique options and use `other: true` only when free text is useful. Keep the same `id` for wording edits that preserve the question's meaning; choose a new ID when its meaning or options change. A changed checkbox label gets a new generated ID; keep its text stable while collecting answers. Invalid ask blocks remain ordinary code fences.

Checkbox taps, ask choices, and Other text autosave as editable drafts. There is no Send control or answer submission. Use these controls to organize a decision, then respond in chat. A choice is neither feedback delivery nor approval for a Point One action.

## Draft persistence

The reader uses `/api/drafts` on the note's own origin. `GET` returns `{rev,blocks,responses}`; the historical `responses` field now contains only draft selection state. New entries have `block_id`, `kind`, `selections`, `free_text` and `updated_at`; readback adds `active` to distinguish removed blocks. Legacy submission metadata can remain stored, but has no submission meaning and is never used to notify Point One.

`POST /api/drafts` accepts `{key,if_rev,changes:[{block_id,selections,free_text}]}`. The browser uses its note cookie. `if_rev` shares the content/comments revision; stale writes return 409 without changing the note. Checkbox selections hold their label or an empty array; ask choices hold option labels and optional Other text. A `submit` field is rejected. `/api/responses` and `/api/responses/receipt` have been removed. Existing selections, revision checks, rename, TTL and ordinary publishing/readback remain intact, with no storage migration.

Preview includes a synthetic `/?key=reaction-demo-v1&persist=1` note, seeded once in the isolated Preview namespace. It expires after seven days and is shared among Preview visitors.
