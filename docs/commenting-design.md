# Commenting prototype

Recommendation: add quote-anchored threads to the existing reader, with a phone-sized sheet and a revision-checked API. Keep the raw Markdown editor. This is a prototype for review, not a production rollout.

## Anchors and editing

Store the selected raw Markdown as `exact` plus 48 UTF-16 code units of `prefix` and `suffix`, inspired by the [W3C TextQuoteSelector](https://www.w3.org/TR/annotation-model/#text-quote-selector). Rendered text leaves carry source offsets from the Markdown parser; selections spanning bold text or links include the intervening Markdown syntax. Offsets are UTF-16, not bytes. Inline entities and escapes support whole-leaf selections; partial selections through decoded leaves and fenced code without parser positions are not supported yet. Selecting more surrounding text is the prototype fallback.

At every comments read and mutation response, project each immutable quote onto the current source: unique exact match, or unique exact match with both contexts when repeated. This computes the current anchor after any write, including old content-only clients, without storing offsets that could go stale. Removed or ambiguous quotes become `outdated`, keep the original quote/messages, and remain in the open list. No fuzzy relocation or automatic resolution. A unique literal quote is evidence of location, not semantic continuity; a rewrite that reuses identical wording in another place can still be mistaken. This is a deliberate prototype limit to review before production.

## Storage and concurrency

Use a separate JSON `comments` field in the existing `note:{key}` hash, with a maximum 100 threads, 100 messages per thread, 4,000 characters per message, 8,000 per quote and 256 KiB total comments. This is logically separate from content but physically shares its lifecycle: existing Lua writes preserve the field, rename moves it, TTL changes apply to it, expiry/delete remove it. No independent Redis key or migration is needed. Content keeps its 1 MiB limit.

A shared `rev` increments for every successful content or comments mutation. Every comments write requires `if_rev`; one Lua compare-and-swap commits the complete comments field and optional replacement content together. It also compares the previously read source/comments to reject an intervening change. A conflict returns 409 and requires rereading and reviewing, never a blind retry. This conservatively makes even replies conflict with unrelated edits; it keeps the prototype small and prevents an agent resolving a newly changed conversation. Timestamps and IDs are generated server-side. There is no history or exactly-once retry token: after a network timeout, reread to determine whether the action committed.

## Roles and visibility

Lawrence's decision: exactly two labels. Browser cookie requests are `You`; explicit-key API requests are `Agent`. No names or role picker. These labels describe the request path and cannot prove a human/agent identity. Any bearer-key holder can use either request path and can read, reply, edit, resolve or reopen. Persist links still grant full access. Comments load automatically in view mode after hydration; they are never serialized into initial page HTML or included in metadata, OG images or preview snippets. This is presentation hiding, not separate access control.

## Phone interaction

Long-press/select text, adjust handles, then tap the small speech-bubble icon below the selection. It waits briefly for selection adjustments to settle and preserves the native selection callout; it does not intercept document touch gestures. The compact composer focuses synchronously inside that tap, allowing iOS to open its keyboard without another field tap. Type and send with the icon. On desktop, Enter or Cmd/Ctrl+Enter sends and Shift+Enter inserts a newline; mobile Return inserts a newline. Composition/IME Enter never submits prematurely.

Subtle highlights open existing threads with a focused reply. Resolve/reopen/close use icons. A comments icon and open-count badge live in the existing toolbar; the list can include resolved and outdated threads. Desktop uses a small selection-adjacent popover; phones use a compact bottom sheet above the visual viewport's keyboard boundary. Both follow the page's dark mode. A native dialog manages focus/dismissal. The [selectionchange event](https://developer.mozilla.org/en-US/docs/Web/API/Document/selectionchange_event) tracks handle adjustments. There is no mode toggle, persistent instruction panel or additional UI dependency. Comments reload after local revision changes or opening the list; no live push or polling.

Before: enable mode → select → bottom button → focus field → type → post (6 steps). After: select → nearby icon → type → send (4 steps). Automated iPhone-sized WebKit tests use touch taps and verify focus without clicking the input; actual iOS keyboard/callout behavior still needs a physical phone trial.

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

## Approved decisions and remaining limits

Lawrence approved comments being readable by every bearer-link holder and exact-quote anchoring with the Outdated fallback. You/Agent roles and the staging trial are also decided. Merge/deploy to production still requires separate review.

Known limits: no authenticated identity, no per-thread delete/edit, no manual reattachment, no history/undo, no notifications, no actual iPhone keyboard/callout evidence yet, shared-demo contention, and Preview API calls blocked by Vercel protection unless the caller already has authorized access.
