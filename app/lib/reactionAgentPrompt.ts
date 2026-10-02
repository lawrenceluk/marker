/** Added to the home page's Copy agent prompt without rewriting its historical API brief. */
export const REACTION_AGENT_PROMPT = `## Reactions

When a shared document asks Lawrence to react, author standard Markdown task lists such as \`1. [ ] Tidy the inbox\` and/or a readable fenced \`ask\` block:

\`\`\`ask
id: review-format
question: What should change?
type: multi
options:
- Shorter summary
- Clearer next steps
other: true
\`\`\`

Use a unique, stable id per ask. Type may be single or multi. Checkboxes, choices and Other text autosave as editable drafts; there is no Send control or answer submission. Lawrence responds in chat. Draft selection state persists on the note's origin through /api/drafts and shares the content/comments revision. Drafts and comments never authorize Point One actions; those still require a separately bound chat approval.`;
