import { DEMO_KEY, ensurePreviewDemo } from "./lib/demo";
import { SPEC_KEY } from "./lib/spec-sample";
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

const readNote = cache(async (key: string) => {
  await ensurePreviewDemo(key);
  return loadNote(key);
});

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
    <>
    {process.env.VERCEL_ENV === "preview" && <aside className="bg-amber-100 text-zinc-900 px-4 py-3 text-center text-sm">Preview sandbox · Separate note namespace · <a className="underline" href={persistPath(DEMO_KEY)}>Open commenting demo</a> · <a className="underline" href={`${persistPath(SPEC_KEY)}&tap=jev&tapwait=700`}>Open selection spec</a></aside>}
    <NoteApp
      initialKeyLabel={key ? maskKey(key) : null}
      initialNote={note ? { content: note.content, rev: note.rev } : null}
      initialPersist={persist}
      tapSelectPreview={process.env.VERCEL_ENV === "preview"}
    />
    </>
  );
}
