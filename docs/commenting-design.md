# Commenting prototype

Recommendation: add quote-anchored threads to the existing reader, with a phone-sized sheet and a revision-checked API. Keep the raw Markdown editor. This is a prototype for review, not a production rollout.

## Anchors and editing

Store the selected raw Markdown as `exact` plus 48 UTF-16 code units of `prefix` and `suffix`, inspired by the [W3C TextQuoteSelector](https://www.w3.org/TR/annotation-model/#text-quote-selector). Rendered text leaves carry source offsets from the Markdown parser; selections spanning bold text or links include the intervening Markdown syntax. Offsets are UTF-16, not bytes. Inline entities and escapes support whole-leaf selections; partial selections through decoded leaves and fenced code without parser positions are not supported yet. Selecting more surrounding text is the prototype fallback.

At every comments read and mutation response, project each immutable quote onto the current source: unique exact match, or unique exact match with both contexts when repeated. This computes the current anchor after any write, including old content-only clients, without storing offsets that could go stale. Removed or ambiguous quotes become `outdated`, keep the original quote/messages, and remain in the open list. No fuzzy relocation or automatic resolution. A unique literal quote is evidence of location, not semantic continuity; a rewrite that reuses identical wording in another place can still be mistaken. This is a deliberate prototype limit to review before production.

## Storage and concurrency

Use a separate JSON `comments` field in the existing `note:{key}` hash, with a maximum 100 threads, 100 messages per thread, 4,000 characters per message, 8,000 per quote and 256 KiB total comments. This is logically separate from content but physically shares its lifecycle: existing Lua writes preserve the field, rename moves it, TTL changes apply to it, expiry/delete remove it. No independent Redis key or migration is needed. Content keeps its 1 MiB limit.

A shared `rev` increments for every successful content or comments mutation. Every comments write requires `if_rev`; one Lua compare-and-swap commits the complete comments field and optional replacement content together. It also compares the previously read source/comments to reject an intervening change. A conflict returns 409 and requires rereading and reviewing, never a blind retry. This conservatively makes even replies conflict with unrelated edits; it keeps the prototype small and prevents an agent resolving a newly changed conversation. Timestamps and IDs are generated server-side. There is no history or exactly-once retry token: after a network timeout, reread to determine whether the action committed.

## Roles and visibility

Lawrence's decision: exactly two labels. Browser cookie requests are `You`; explicit-key API requests are `Agent`. No names or role picker. These labels describe the request path and cannot prove a human/agent identity. Any bearer-key holder can use either request path and can read, reply, edit, resolve or reopen. Persist links still grant full access. Comments are available on those views after tapping “Comment on this note”, with a warning beside the control; they are never serialized into initial page HTML or included in metadata, OG images or preview snippets. This is presentation hiding, not separate access control.

## Phone interaction

Tap “Comment on this note”, long-press/select text, adjust handles, then tap the fixed “Comment on selection” button. A native modal sheet holds the quote and composer. Highlights reopen threads; Threads lists open and outdated threads and can include resolved ones. Browser posts/replies say You. The native dialog handles focus and dismissal; controls have 44 px minimum height. The [selectionchange event](https://developer.mozilla.org/en-US/docs/Web/API/Document/selectionchange_event) tracks handle adjustments. Automated WebKit emulation exercises DOM selection and the full flow; actual iOS long-press/menu interference still needs Lawrence's phone trial. No live push or polling: reopen Threads to refresh.

## API

Use the origin of the supplied note link, especially for staging. Never substitute the production origin for a Preview link.

- `GET /api/comments?key=KEY&status=open` (default open; also resolved/all) returns `{rev, content, comments}` in one snapshot. Each thread includes its original `anchor`, `created_rev`, `resolved`, `messages`, and current `location` (`attached` with raw source `start`, `end`, `text`, or `outdated` with `text:null`).
- `POST /api/comments` takes `{key, if_rev, operations, content?}`. Operations are `{action:"create",start,end,text}`, `{action:"reply",id,text}`, `{action:"resolve",id}` or `{action:"reopen",id}`; 1–50 per request. Create offsets address the content from `if_rev`, before any replacement content in that request.
- Example agent flow: GET open comments; review current source and original/current quotes; POST a revised `content` and operations `[{action:"reply",id,text:"Updated that section."},{action:"resolve",id}]` with that `if_rev`. GET again to verify. If a thread is outdated, read its original quote and conversation before acting.
- Error statuses: 400 invalid input/limits, 404 missing note, 409 revision race, 413 oversized request/content. All comments responses use no-store and noindex headers. Existing `/api/content` remains compatible.

## Staging isolation

When `VERCEL_ENV=preview`, every note and legacy key is prefixed with `marker-commenting-preview-v1:`. This includes content APIs, comments, rename/delete and OG reads. Other environments retain existing key names. This is the approved minimum isolation if the Git integration gives Preview the production Redis credentials; Redis account-level billing and capacity are still shared. Production/Preview credential allocation is unverified because this machine has no Vercel CLI login. Preview builds intentionally share one prototype namespace so a branch rebuild preserves the demo.

Opening `/?key=commenting-demo-v1&persist=1` in Preview atomically creates an absent synthetic demo with an open You thread and Agent reply, a resolved thread, and an outdated thread. It never resets an existing note and expires after seven days. A preview-only banner links to it. This URL/key is deliberately public synthetic data. Vercel Git integration supplies the Preview deployment; no production env changes, production deployment or protection changes are authorized. The expected Vercel sign-in requirement must be reported with the deployment URL.

## Rejected alternatives

- Numeric offsets alone: edits before a selection move the anchor silently.
- Fuzzy/LLM re-anchoring: guesses can attach a request to the wrong passage.
- Rendered quote search directly in raw Markdown: fails across formatting, links and escaping.
- Separate Redis comments key: adds cross-key expiry, rename and delete failure modes without a prototype benefit.
- Independent comment revisions: less contention, but more conflict contracts for atomic edit-and-resolve.
- Accounts, permissions, notifications, CRDTs, history and a rich editor: expand this focused trial into a different product.
- Hide comments from key-bearing persist visitors as “private”: cannot enforce that with the existing bearer credential.

## Decisions for Lawrence

1. Are comments accessible to anyone with the existing note link acceptable? Recommended yes for this prototype; private comments require separate credentials later.
2. Is conservative exact-quote anchoring, with visible outdated threads after larger rewrites, useful enough in practice? Recommended trial it before adding reattachment/history machinery.

The two role labels and Vercel staging trial are already decided. Merge/deploy to production requires separate review. Known limits: no authenticated identity, no per-thread delete/edit, no manual reattachment, no history/undo, no notifications, no actual iPhone touch evidence yet, shared-demo contention, and Preview API calls blocked by Vercel protection unless the caller already has authorized access.
