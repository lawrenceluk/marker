import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NoteView } from "../components/NoteView";
import { PERSIST_COOKIE, SESSION_COOKIE, normalizeKey } from "../lib/key";

/**
 * The current session note: where one-off `/?key=` links, folder rows and
 * notes opened from Home land. Reloading keeps the note; `/` stays Home.
 */
export default async function SessionNote() {
  const cookieStore = await cookies();
  const key = normalizeKey(cookieStore.get(SESSION_COOKIE)?.value);
  if (!key) redirect("/");
  return <NoteView noteKey={key} persist={cookieStore.get(PERSIST_COOKIE)?.value === "1"} />;
}
