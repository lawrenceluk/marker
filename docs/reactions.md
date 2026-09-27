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

Checkbox taps save a draft immediately. Ask choices and Other text stay in the reader until Send. Send submits the active blocks together; later changes return a block to draft until the next Send. This distinction lets a reader mark progress without accidentally treating each tap as a final answer.

## Read responses

Use the origin and bearer key from the specific note link. For Preview, keep every request on that Preview origin. `GET /api/responses?key=KEY` returns `{rev,blocks,responses}`. Each response has `block_id`, `kind`, `selections`, `free_text`, `updated_at`, `submitted_at`, and `active`. `submitted_at:null` means draft; treat only a non-null submission as sent feedback. `active:false` means the source block was removed or changed, so review its history before acting. A checkbox selection contains its label when checked and is empty when unchecked. Ask selections contain option labels, including `Other` when its text is used.

The browser uses the note cookie; an agent can pass `key` explicitly. `POST /api/responses` accepts `{key,if_rev,changes:[{block_id,selections,free_text}],submit:boolean}`. `if_rev` is required and shares the content/comments revision. `submit:true` stamps every current block, including unchecked items. On 409, reread the note and responses before retrying. The key is the only access control; anyone with it can edit responses. Responses do not appear in initial HTML or link previews.

Preview includes a synthetic `/?key=reaction-demo-v1&persist=1` note, seeded once in the isolated Preview namespace. It expires after seven days and is shared among Preview visitors.
