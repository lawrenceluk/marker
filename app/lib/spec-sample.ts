/** Fictional, shared Preview note for trying quote selection on varied prose. */
export const SPEC_KEY = "commenting-spec-trial-v1";

export const SPEC_CONTENT = `# Atlas Tool Share — synthetic product brief

Atlas Tool Share is a fictional neighborhood library for borrowing tools that sit idle most of the year. This write-up is test material for comments and quote selection; it contains no real member data.

## The bet

Borrowing a drill should feel easier than buying one for a single shelf. The first release will serve one pickup location and a small catalog, because a reliable handoff matters more than a map full of unavailable tools. Success means a borrower can find a suitable item, understand its limits, and arrange a pickup without a staff member translating the listing.

The catalog should explain what each tool can actually do. A battery-powered drill can assemble furniture, but it may not be suitable for masonry; that distinction belongs next to the item, not in a separate policy page. Each listing includes a plain-language use case, the included accessories, a condition note, and one clear photo.

## Borrowing flow

1. Search or browse by task, then compare the two or three tools that fit. A search for “hang shelves” should surface a drill and a level without assuming the borrower knows model names.
2. Choose an available pickup window. A reservation holds the item for 48 hours, but it does not guarantee pickup until the borrower confirms the handoff code at the desk.
3. Return the tool to the same location. The receipt records condition and missing accessories before the item becomes available again.

Reservations do not guarantee pickup. That short rule should remain visible even when the rest of the flow is simplified.

## Constraints and tradeoffs

- **Safety first:** tools with a damaged cord or missing guard stay unavailable, even if that leaves a popular category empty for a day.
- **No late fees in the trial:** reminders at 24 and 4 hours before the due time should reduce overdue returns without punishing a member who needs help arranging a return.
- **Low-bandwidth access:** the catalog must remain readable on an older phone, and a reservation confirmation should work without downloading every product image.
- **Privacy:** store the minimum contact detail needed for a handoff; do not put a member's address or borrowing history in a public listing.

There is a real tradeoff between immediate availability and careful inspection. Releasing a returned tool before a volunteer checks its condition could make the next pickup faster, but a broken tool would cost more trust than the saved hour is worth. For the trial, inspection wins.

## Decisions to test

We expect task-based search to help first-time borrowers more than brand filters. We are less sure whether people want a precise pickup time or a wider afternoon window. A short [safety checklist](#safety) should be available beside risky tools, but it should not interrupt someone borrowing a simple tape measure.

### Safety

The handoff screen asks the borrower to confirm that they received the listed accessories. If a tool needs protective equipment, the listing names it before reservation; the desk can still refuse a handoff when the required equipment is missing. “Available” must never mean “safe without inspection.”

## Trial boundaries

The first four weeks cover one location, about thirty tools, and volunteers who can inspect returns during posted hours. We will review failed searches, abandoned reservations, overdue returns, and comments about confusing descriptions each week. We will not add delivery or peer-to-peer handoffs until the pickup flow works reliably.

This is a shared synthetic Preview fixture. Anyone with this trial link can comment or edit it, and an expired fixture is recreated from this source after seven days.
`;
