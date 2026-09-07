import type { Metadata } from "next";
import { cache } from "react";
import { cookies } from "next/headers";
import { NoteApp } from "./components/NoteApp";
import {
  PERSIST_COOKIE,
  PERSIST_QUERY,
  SESSION_COOKIE,
  isPersistParam,
  maskKey,
  normalizeKey,
  persistPath,
} from "./lib/key";
import { readNote as loadNote } from "./lib/notes";
import { requestOrigin } from "./lib/origin";
import { previewFromMarkdown } from "./lib/preview";

const readNote = cache(loadNote);

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

  const note = await readNote(key);
  const preview = previewFromMarkdown(
    typeof note?.content === "string" ? note.content : ""
  );
  if (!preview) {
    return FALLBACK;
  }

  const url = `${await requestOrigin()}${persistPath(key)}`;
  const { title, description } = preview;
  // Root `description` is also the OG/Twitter fallback in Next.js. Never leave
  // it unset on a persist URL or the generic site tagline would unfurl.
  const snippet = description || title;

  return {
    title,
    description: snippet,
    openGraph: {
      title,
      description: snippet,
      url,
      siteName: "Marker",
      type: "website",
    },
    twitter: {
      card: "summary",
      title,
      description: snippet,
    },
  };
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ key?: string; persist?: string }>;
}) {
  const params = await searchParams;
  const cookieStore = await cookies();
  const cookieKey = normalizeKey(cookieStore.get(SESSION_COOKIE)?.value);
  const persistFromCookie = cookieStore.get(PERSIST_COOKIE)?.value === "1";
  const persistFromUrl = isPersistParam(params[PERSIST_QUERY]);
  const persist = persistFromCookie || persistFromUrl;

  // Persist links skip the cookie+redirect hop, so the first render may not
  // see the cookie the proxy just set. The URL is the document identity —
  // prefer it so a rename (cookie still catching up) does not flash the
  // previous key as a missing note.
  const key = persist
    ? (normalizeKey(params.key) ?? cookieKey)
    : cookieKey;
  const note = key ? await readNote(key) : null;

  return (
    <NoteApp
      initialKeyLabel={key ? maskKey(key) : null}
      initialNote={note ? { content: note.content, rev: note.rev } : null}
      initialPersist={persist}
    />
  );
}
