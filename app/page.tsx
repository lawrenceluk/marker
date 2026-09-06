import { cookies } from "next/headers";
import { NoteApp } from "./components/NoteApp";
import {
  PERSIST_COOKIE,
  PERSIST_QUERY,
  SESSION_COOKIE,
  isPersistParam,
  maskKey,
  normalizeKey,
} from "./lib/key";
import { readNote } from "./lib/notes";

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
  // see the cookie the proxy just set. Fall back to the URL key only then.
  const key = cookieKey ?? (persist ? normalizeKey(params.key) : null);
  const note = key ? await readNote(key) : null;

  return (
    <NoteApp
      initialKeyLabel={key ? maskKey(key) : null}
      initialNote={note ? { content: note.content, rev: note.rev } : null}
      initialPersist={persist}
    />
  );
}
