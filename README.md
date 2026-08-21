# Marker

A private markdown pastebin. Each note lives at a secret key that both names it
and grants access to it — no accounts, no sign-in. Usable from a browser or,
via a small HTTP API, from AI agents.

## Features

- **Secret Key Access**: A note's key is its address and its password
- **Markdown Support**: Full markdown rendering, including GitHub Flavored Markdown
- **Agent-Friendly API**: Atomic append/prepend and optimistic concurrency (`if_rev`) so several agents can write to one note without clobbering each other
- **Optional Expiry**: Per-note TTL for quick, self-destructing shares
- **Shareable Links**: `/?key=...` moves the key into an httpOnly cookie and renders the note server-side, so the key stays out of the address bar and browser history
- **View & Edit Modes**: Toggle between viewing rendered markdown and editing raw content
- **Dark Mode**: Automatic dark mode support
- **Scroll Actions**: Quick navigation buttons to scroll to top or bottom
- **Redis Storage**: Persistent storage using Upstash Redis

## Security model

There is no authentication beyond the key, so treat a key like a password:
generate it randomly (`openssl rand -hex 16`) and share it only with people and
agents you want to have full read/write access. Anyone with the key can read and
overwrite the note.

Only the current value of a note is stored — there is no version history, so an
overwrite cannot be undone. Notes are excluded from search indexing and carry no
Open Graph tags, so pasting a link into a chat app won't unfurl its contents into
the channel.

## Tech Stack

- **Next.js 16** - React framework
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **Upstash Redis** - Data storage
- **react-markdown** - Markdown rendering
- **remark-gfm** - GitHub Flavored Markdown support

## Getting Started

### Prerequisites

- Node.js 18+ 
- An Upstash Redis instance (or compatible Redis)

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd marker
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:

Create a `.env.local` file in the root directory:

```env
KV_REST_API_URL=your_upstash_redis_url
KV_REST_API_TOKEN=your_upstash_redis_token
```

4. Run the development server:
```bash
npm run dev
```

5. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Usage

1. Enter a secret key to access or create a note
2. If the key exists, you'll see the rendered markdown
3. Click "Edit" to modify the content
4. Save your changes to persist them
5. Use "Change Key" to switch to a different note

You can also open a note directly at `/?key=<key>`. The server takes the key out
of the URL, stores it in an httpOnly session cookie, and redirects to `/` before
rendering — so the key never appears in the address bar, browser history, a
`Referer` header, or client-side JavaScript.

That cookie is what keeps you in the note across reloads. It is cleared by
"Change Key" or by closing the browser.

Because only the current value of a note is stored, saving from the browser
sends the revision it loaded. If an agent wrote to the note while you had it
open, you get a warning and a chance to reconsider instead of a silent
overwrite.

## Using with AI Agents

Marker doubles as a shared scratchpad for agents: a note is just a URL and a
key, so an agent can read and write one with plain HTTP and no browser access.
Several agents can safely work on the same note — `mode: "append"` and `if_rev`
exist specifically so they don't overwrite each other.

Give an agent the blurb below verbatim (in a system prompt, `CLAUDE.md`, or a
tool description) and it will know how to use the API.

````markdown
Marker is a markdown pastebin at https://marker.luk.xyz.

A note is identified by a "key", which is also its only secret: anyone holding
the key can read and overwrite that note. Use a long random key such as the
output of `openssl rand -hex 16`. Keys are trimmed of surrounding whitespace,
otherwise taken literally, and capped at 512 characters.

## Read a note

GET https://marker.luk.xyz/api/content?key=<key>

→ { "content":    string | null,   // null only when "exists" is false
    "exists":     boolean,
    "rev":        number,          // 0 if the note doesn't exist yet
    "updated_at": number | null,   // epoch milliseconds
    "created_at": number | null,
    "expires_at": number | null,
    "size":       number }         // bytes

The response has the same shape whether or not the note exists, so you never
need to branch on "exists" before reading a field. "rev" increases by one on
every write — use it for cheap freshness checks and for "if_rev" below.

## Write a note (creates it if it doesn't exist)

POST https://marker.luk.xyz/api/content
Content-Type: application/json

{ "key":     "<key>",
  "content": "<markdown string>",
  "mode":    "overwrite" | "append" | "prepend",  // optional, default "overwrite"
  "if_rev":  <number>,                            // optional
  "ttl":     <seconds> | 0 | null }               // optional

→ { "success": true, "rev": number, "updated_at": number,
    "expires_at": number | null, "size": number }

## Which mode to use

- Adding to a running log, checklist, or scratchpad → "append" (or "prepend").
  This is applied server-side as one atomic operation, so simultaneous writers
  can't lose each other's work. A newline is inserted between the existing
  content and yours if there isn't one already. Prefer this whenever you are
  only adding material.

- Rewriting or restructuring existing content → GET first, then POST with
  "if_rev" set to the "rev" you just read. If anything wrote in between you get
  a 409 instead of silently destroying their work.

- Creating a note only if the key is still free → "if_rev": 0.

- Unconditional overwrite → omit "if_rev". Only do this when you own the note
  and don't care what was there.

## Handling a 409

409 means the note changed since the "rev" you passed. The response body is
{ "error", "rev", "content" } carrying the current state, so you don't need a
second GET: merge your change into that "content" and retry with that "rev".
Retry a couple of times, then report the conflict rather than looping.

## Expiry

"ttl" is seconds until the note deletes itself; 0 or null removes an expiry.
Omitting "ttl" leaves any existing expiry untouched, so ordinary writes don't
accidentally extend or cancel one. Handy for temporary shares.

## Errors

400 — missing or invalid key, non-string content, bad mode/if_rev/ttl
409 — "if_rev" didn't match; body has the current "rev" and "content"
413 — the resulting note would exceed the 1 MiB limit

## Examples

Append a line to a shared log:
  curl -X POST https://marker.luk.xyz/api/content \
    -H 'Content-Type: application/json' \
    -d '{"key":"KEY","content":"- deployed build 41","mode":"append"}'

Safe read-modify-write:
  curl -s 'https://marker.luk.xyz/api/content?key=KEY'
  # → {"content":"# Plan\n- step one","exists":true,"rev":7,...}
  curl -X POST https://marker.luk.xyz/api/content \
    -H 'Content-Type: application/json' \
    -d '{"key":"KEY","content":"# Plan\n- step one\n- step two","if_rev":7}'

Write a note that self-destructs in an hour, then hand it to a human:
  curl -X POST https://marker.luk.xyz/api/content \
    -H 'Content-Type: application/json' \
    -d '{"key":"KEY","content":"# Handoff\n...","ttl":3600}'
  # then share https://marker.luk.xyz/?key=KEY

## Limits and caveats

- Content is plain markdown (GitHub-flavored), stored and returned verbatim.
- Only the current value is kept. There is no version history, so an overwrite
  is unrecoverable — prefer "append" or "if_rev" over blind overwrites.
- Maximum 1 MiB per note.
- There is no delete endpoint. Write "" to empty a note, or set a short "ttl"
  to make it disappear.
- https://marker.luk.xyz/?key=<key> is the human-facing view/edit page. Use the
  API above rather than fetching that page.
- The key is the only authentication. Don't store credentials or sensitive data
  in a note, and don't paste a key anywhere it will be logged or indexed.
````

## Project Structure

```
marker/
├── app/
│   ├── api/
│   │   ├── content/          # API routes for content CRUD
│   │   └── session/          # Sets/clears the session key cookie
│   ├── components/
│   │   ├── ContentEditor.tsx  # Markdown editor component
│   │   ├── ContentViewer.tsx  # Markdown viewer component
│   │   ├── KeyInput.tsx       # Key input form
│   │   ├── NoteApp.tsx        # Client-side app state and flow
│   │   └── ScrollActions.tsx  # Scroll navigation buttons
│   ├── lib/
│   │   ├── key.ts             # Key validation, masking, session cookie
│   │   ├── notes.ts           # Note storage schema and atomic read/write scripts
│   │   └── redis.ts           # Redis client configuration
│   └── page.tsx               # Server component: resolves the session, renders the note
├── proxy.ts                   # Turns /?key=... into a cookie + redirect
└── README.md
```

## Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint

## Deployment

The easiest way to deploy is using [Vercel](https://vercel.com):

1. Push your code to GitHub
2. Import your repository on Vercel
3. Add your environment variables (`KV_REST_API_URL` and `KV_REST_API_TOKEN`)
4. Deploy

Make sure to set up your Upstash Redis instance and configure the environment variables in your deployment platform.

## License

Private project.
