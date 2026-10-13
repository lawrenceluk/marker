# Creator folders and tags

A note key opens one note. A **creator id** groups many notes into a private
folder that a person can browse at `/c`, filtered by tags. It is meant for an
agent that writes lots of notes for one person: the agent keeps one creator id
per person (or project), attaches every note it writes to it, and gives the
person a single folder link instead of a pile of note links.

## The creator id is a secret

- Whoever holds a creator id can attach notes to that creator, list the
  creator's folder, and **open every note in it from a browser**. Treat it
  like a password, the same way you treat a note key.
- Ids are 22–128 characters of `A-Z a-z 0-9 _ - ~`. Use a long random value
  (`openssl rand -base64 32 | tr '+/' '-_' | tr -d '='`), or send
  `"creator_id": true` and let Marker generate one. A generated id is returned
  **once**, in that response only. Store it.
- Marker stores only `sha256(creator_id)`. The raw id is never written to
  Redis and never returned by any endpoint, so a lost id cannot be recovered.
  There is no rotation yet.
- `creator_name` is a separate display string (1–80 characters, trimmed). It
  is the folder title. The latest write wins.

## Attach, name and tag notes while writing

`POST /api/content` takes these optional fields alongside `key` and `content`:

| Field | Value | Effect |
| --- | --- | --- |
| `creator_id` | string | Attach the note to this creator (or keep it there). |
| | `true` or `"new"` | Generate an id, attach the note, and return `creator_id` in the response. |
| | `null` | Remove the note from its creator. This also removes its tags. |
| | omitted | Leave the creator unchanged. |
| `previous_creator_id` | string | Proof of the note's current creator when moving or removing it. |
| `creator_name` | string | Set the folder title. Requires `creator_id` in the same request. |
| `tags` | string[] | Replace the note's tags. Requires that the note has a creator. |
| | `[]` or `null` | Clear the tags. |
| | omitted | Leave the tags unchanged. |

```
POST /api/content
{ "key": "<note key>", "content": "# Q4 plan\n…",
  "creator_id": "<creator id>", "creator_name": "Lawrence's plans",
  "tags": ["plans", "q4"] }

→ { "success": true, "rev": 1, "updated_at": …, "expires_at": null, "size": …,
    "has_creator": true, "tags": ["plans", "q4"] }
```

Responses include `has_creator` and the normalized `tags`. They include
`creator_id` only when Marker generated it.

### Tags

- Tags are trimmed and lowercased. Each must match `[a-z0-9][a-z0-9_-]{0,31}`.
  A note can have at most 10. They are deduplicated and stored sorted.
- Invalid tags are a 400. Marker never drops one silently.
- Tags belong to a creator. There is no global tag search.

### Who may change what

The note key is still the key to the note's content. Changing a creator's
folder also needs that creator's id:

- **Attaching** a note that has no creator needs only the note key and the
  new `creator_id`.
- **Moving** a note from creator X to creator Y needs `creator_id: Y` plus X's
  id as `previous_creator_id`. Otherwise anyone holding a note key could pull
  notes out of someone else's folder. A wrong or missing id returns 403.
- **Removing** a note from its creator (`creator_id: null`) needs the current
  creator's id. Pass it as `previous_creator_id` or as
  `Authorization: Bearer <creator_id>`.
- **Editing tags** needs the id of the creator the note ends up with. Pass it
  as `creator_id`, `previous_creator_id`, or `Authorization: Bearer`.
- Plain content writes (`content`, `mode`, `if_rev`, `ttl`) need nothing new.
  They also bump the note to the top of its folder and refresh its title.

Moving a note keeps its tags. Removing the creator clears them.

## Change metadata without writing content

```
PATCH /api/meta
{ "key": "<note key>", "creator_id"?: …, "previous_creator_id"?: …,
  "creator_name"?: …, "tags"?: … }

→ { "success": true, "has_creator": true, "creator_name": "…", "tags": [ … ] }
```

The fields mean the same as on `POST /api/content`. This call does **not**
change `rev`, `updated_at`, content, comments or expiry, so it never conflicts
with an `if_rev` writer. It returns 404 if the note doesn't exist, 403 without
the needed creator id, and 400 for invalid input or an empty request.

## Read a note's creator

`GET /api/content` also returns:

- `has_creator` (boolean)
- `creator_name` (string or null)
- `tags` (string[])
- `creator_linked` (boolean): true when the request's creator credential
  (`Authorization: Bearer` or the folder cookie) matches the note's creator.

The id itself is never returned, because it isn't stored.

## List a folder

```
GET /api/creator?tag=plans&tag=q4&sort=updated&cursor=0
Authorization: Bearer <creator id>

→ { "creator_name": "Lawrence's plans" | null,
    "created_at": number | null,
    "tags":  [ { "tag": "q4", "count": 3 }, … ],     // every tag the creator uses
    "notes": [ { "ref", "title", "tags", "updated_at", "created_at", "expires_at" }, … ],
    "total": number,                                 // notes matching the filter
    "next_cursor": number | null }
```

- Repeating `tag` filters with AND. Notes must carry every listed tag.
- `sort` is `updated` (newest first, the default), `created` (newest first),
  or `title` (A–Z).
- A page holds 50 notes. Pass `next_cursor` back as `cursor`. A missing or
  wrong id returns 404.
- `title` is the note's first line of plaintext, the same text used for link
  previews.
- `ref` is an opaque handle, not the note key. It only works in a browser at
  `/c/open/<ref>` with that creator's folder cookie. To read a note over the
  API, keep using its key.
- Expired or deleted notes disappear lazily. They are pruned from the index,
  and their tag counts decremented, the next time a page that contains them
  is listed.
- Repeated wrong-id lookups from one client are rate limited (429).

## Hand the folder to a person

Give the person this link:

```
https://marker.luk.xyz/c?token=<creator id>
```

On the first visit Marker moves the id into an httpOnly `marker_creator`
cookie (SameSite=Lax, one year) and redirects through `/c/enter`, which checks
the id exists and then redirects to a clean `/c` (other query parameters such
as `tag` are kept). The id does not stay in the address bar or history. People
can also open `/c` and paste the id.

The folder shows a Home button, the creator name as the title, tag chips with
counts, and the notes sorted by Updated, Created or Title. Tapping a chip adds
or removes it from the filter (selected tags AND together). Double-tapping,
double-clicking or long-pressing a chip shows only that tag. Quick taps are
combined into one listing request.
Opening a row opens the note at `/n` in a normal one-off browser session.
Inside a note, the creator name and tag pills appear under the toolbar. When
the browser's folder cookie matches the note's creator, the name links back to
the folder and **More → Edit tags** is available. **⋯ → Forget this folder** on `/c`
removes the cookie and drops the folder from the home page list.

## Folders on the home page

Every folder that a browser successfully opens, whether through a token link or
by pasting an id on `/c`, is remembered in a second httpOnly cookie,
`marker_folders` (SameSite=Lax, one year). It holds up to 10 entries, each
storing the folder's id and the time it was last visited. The home page lists
them under **Folders**, most recently visited first, with each folder's
`creator_name` (or "Untitled folder") and note count.

- Raw ids never reach the page. Each row links to `/c/folder/<ref>`, where
  `ref` is an HMAC of the folder's hash. That route finds the matching
  remembered id in the cookie, makes it the active `marker_creator`, moves it
  to the front of the list and redirects to `/c`. A ref that doesn't match the
  browser's own cookie redirects to `/`.
- **⋯ → Forget folder** on a row posts to `/api/creator/folders`, which removes the entry (and
  clears `marker_creator` if it was the active folder), then redirects to `/`.
- Folders whose index no longer exists drop out of the list.
- Counts come from the index size, so notes that expired since the folder was
  last listed are still counted until a listing prunes them.
- `GET /api/creator/folders` returns the same summaries as JSON
  (`{ "folders": [{ "ref", "name", "count", "visited_at" }] }`). The home page
  uses it when you return there from a note without a full page load.

`/c` and every API response are `noindex`, `no-store, private`, and have no
link previews.

## Limits and lifecycle

- A creator's index holds up to 2,000 notes. When a write adds one more, the
  least recently updated note leaves the folder: it loses its creator and
  tags, but the note itself is kept and still opens with its key.
- One creator per note.
- Renaming a note's key keeps it in its folder, with the same tags and
  position. Deleting a note removes it from its folder.
- Existing notes are not backfilled. They stay unlisted until a write or
  `PATCH /api/meta` attaches a `creator_id`.
- Out of scope for now: accounts, global or free-text search, renaming or
  merging tags, bulk actions, and creator id rotation.

## Storage and Redis cost

Each note hash gains `title` on every content commit. Notes with a creator
also get `cid` (the sha256 hex of the creator id), `tags` (a JSON array) and
`meta_updated_at`. Index keys live under the storage prefix:

| Key | Type | Contents |
| --- | --- | --- |
| `cidx:<cid>` | ZSET | note key → updated_at |
| `cidx:<cid>:t:<tag>` | SET | note keys with the tag |
| `cidx:<cid>:tags` | HASH | tag → count (removed at 0) |
| `cidx:<cid>:meta` | HASH | `name`, `created_at`, `updated_at` |
| `crl:<client hash>` | STRING | failed creator lookups, 15-minute window |

Every index change runs inside the same `EVAL` as the commit, rename or
delete, so existing paths cost the same number of Redis commands as before.
A write is still 2 commands, and a read, rename or delete is 1. A write
without creator fields, to a note without a creator, touches no index key.
`PATCH /api/meta`, a folder page (`GET /api/creator` or `/c`), and opening a
row each cost one `EVAL`. Nothing polls the folder.

The home page costs no Redis commands when the browser remembers no folders,
and one `EVAL` for the whole Folders list otherwise (an `HGET` and `ZCARD` per
folder inside the script). Remembered ids that don't resolve count as failed
lookups toward the `crl:` rate limit, so a forged cookie can't be used to probe
for ids. While that limit is hit, the list still shows but without names or
counts. Switching folders from the home page (`/c/folder/<ref>`) and forgetting
one cost nothing. Following a token link adds one `EVAL` for the `/c/enter`
check, on top of the `/c` page itself.

## What's new

A note is new when it changed since a person last saw it. There are no accounts, so "a person"
is whoever uses a browser: any device that opens the note marks it seen.

- Each note stores `seen_rev` and `seen_at`. A note is unseen when `rev > seen_rev`.
- A browser view marks the note seen after the page loads and only while the tab is visible,
  naming the revision it rendered (link unfurlers that fetch HTML never count). Refreshing
  through `GET /api/content` with the session cookie also marks it seen.
- Writes, comments and reaction drafts made in the browser (session cookie) stay seen. The same
  writes with an explicit key are an agent's: they leave the note unseen. The first agent write
  to a note no one has seen marks the revision before it as seen, so that change shows.
- Agent reads never mark a note seen. Any client may: `PATCH /api/meta` with
  `{ "key", "seen": true, "rev"? }`. A mark never moves past the current revision or back
  from an earlier one.
- Notes that predate tracking have `seen_rev: null` and are never new until something changes.
- Folders keep a set of their new notes (`cidx:<cid>:new`), maintained on write and verified
  when Home counts it, so notes that were seen, moved, expired or deleted drop out.

The folder page marks new notes with an accent dot; Home shows "N new" on each remembered folder.
