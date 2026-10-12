import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { NoteView, readPageNote as readNote } from "./components/NoteView";
import { PERSIST_QUERY, isPersistParam, normalizeKey, persistPath } from "./lib/key";
import { clientFingerprint } from "./lib/creators";
import { readRememberedFolders, summarizeFolders, type FolderSummary } from "./lib/folders";
import { requestOrigin } from "./lib/origin";
import { previewFromMarkdown } from "./lib/preview";

const FALLBACK: Metadata = {
  title: "Marker",
  description: "Private markdown notes with secret keys",
};

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ key?: string; persist?: string }>;
}): Promise<Metadata> {
  const params = await searchParams;
  if (!isPersistParam(params[PERSIST_QUERY])) {
    return FALLBACK;
  }

  const key = normalizeKey(params.key);
  if (!key) {
    return FALLBACK;
  }

  const note = await readNote(key, false);
  const preview = previewFromMarkdown(
    typeof note?.content === "string" ? note.content : ""
  );
  if (!preview) {
    return FALLBACK;
  }

  const origin = await requestOrigin();
  const url = `${origin}${persistPath(key)}`;
  const { title, description } = preview;
  // Root `description` is also the OG/Twitter fallback in Next.js. Never leave
  // it unset on a persist URL or the generic site tagline would unfurl.
  const snippet = description || title;
  // Visual card: generated PNG of the note body start (not the brand mark).
  const image = {
    url: `${origin}/og?key=${encodeURIComponent(key)}&v=4`,
    width: 1200,
    height: 630,
    alt: title,
  };

  return {
    title,
    description: snippet,
    icons: {
      icon: [{ url: `${origin}/icon.svg?v=3`, type: "image/svg+xml" }],
      apple: [{ url: `${origin}/apple-icon?v=3` }],
    },
    openGraph: {
      title,
      description: snippet,
      url,
      siteName: "Marker",
      type: "website",
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: snippet,
      images: [image.url],
    },
  };
}

/**
 * `/` is always Home unless the URL itself names a note (a persistent
 * `/?key=…&persist=1` link). The session cookie is deliberately ignored here:
 * the current session note lives at `/n`.
 */
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ key?: string; persist?: string }>;
}) {
  const params = await searchParams;
  const key = isPersistParam(params[PERSIST_QUERY]) ? normalizeKey(params.key) : null;
  if (key) return <NoteView noteKey={key} persist />;

  let folders: FolderSummary[] = [];
  try {
    folders = await summarizeFolders(readRememberedFolders(await cookies()), clientFingerprint(await headers()));
  } catch {
    // Home must render even if Redis is unavailable; folders are a convenience.
  }
  return <NoteView noteKey={null} persist={false} folders={folders} />;
}
