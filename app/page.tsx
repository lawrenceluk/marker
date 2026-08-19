import { cookies } from "next/headers";
import { NoteApp } from "./components/NoteApp";
import { SESSION_COOKIE, maskKey, normalizeKey } from "./lib/key";
import { readNote } from "./lib/notes";

export default async function Home() {
  // Reading the cookie opts this page out of static rendering, which is what
  // lets the note be rendered server-side for whoever holds the key.
  const key = normalizeKey((await cookies()).get(SESSION_COOKIE)?.value);
  const note = key ? await readNote(key) : null;

  return (
    <NoteApp
      initialKeyLabel={key ? maskKey(key) : null}
      initialNote={note ? { content: note.content, rev: note.rev } : null}
    />
  );
}
