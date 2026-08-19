# Marker

A private markdown notes application with secret key-based access. Store and edit your notes securely using a simple key system.

## Features

- **Secret Key Access**: Access your notes using a private key
- **Markdown Support**: Write and view notes with full markdown rendering (including GitHub Flavored Markdown)
- **View & Edit Modes**: Toggle between viewing rendered markdown and editing raw content
- **Dark Mode**: Automatic dark mode support
- **Scroll Actions**: Quick navigation buttons to scroll to top or bottom
- **Redis Storage**: Persistent storage using Upstash Redis

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

## Using with AI Agents

Marker works as a simple markdown pastebin: give an agent the blurb below (verbatim) and it will know how to read and write notes via the API, without needing browser access.

````markdown
Marker is a markdown pastebin at https://marker.luk.xyz. A note is identified
by a "key", which also acts as its secret — anyone who has the key can read
and overwrite that note, so use a long, random, hard-to-guess key.

- Read a note:
  GET https://marker.luk.xyz/api/content?key=<key>
  → { "content": string | null, "exists": boolean }

- Write/overwrite a note (creates it if it doesn't exist):
  POST https://marker.luk.xyz/api/content
  Content-Type: application/json
  Body: { "key": "<key>", "content": "<markdown string>" }
  → { "success": true }

- View/edit a note in the browser (no need to type the key in):
  https://marker.luk.xyz/?key=<key>

Content is plain markdown (GitHub-flavored). There is no authentication
beyond the key itself, so don't store sensitive secrets in it.
````

## Project Structure

```
marker/
├── app/
│   ├── api/
│   │   └── content/          # API routes for content CRUD
│   ├── components/
│   │   ├── ContentEditor.tsx  # Markdown editor component
│   │   ├── ContentViewer.tsx  # Markdown viewer component
│   │   ├── KeyInput.tsx       # Key input form
│   │   └── ScrollActions.tsx  # Scroll navigation buttons
│   ├── lib/
│   │   └── redis.ts           # Redis client configuration
│   └── page.tsx               # Main application page
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
