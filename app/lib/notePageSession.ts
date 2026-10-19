import { cookies } from "next/headers";
import { PERSIST_COOKIE, normalizeKey } from "@/app/lib/key";
import {
  SESSION_HANDLE_COOKIE,
  isSessionHandle,
  sessionKeyCookieName,
  signNoteBinding,
} from "@/app/lib/noteSession";

export type PageNoteSession = {
  binding: string;
  handle: string;
  key: string;
  persist: boolean;
};

export async function readPageNoteSession(
  expectedKey?: string | null
): Promise<PageNoteSession | null> {
  const store = await cookies();
  const handle = store.get(SESSION_HANDLE_COOKIE)?.value;
  if (!handle || !isSessionHandle(handle)) return null;
  const key = normalizeKey(store.get(sessionKeyCookieName(handle))?.value);
  if (!key) return null;
  if (expectedKey && key !== expectedKey) return null;
  const persist = store.get(PERSIST_COOKIE)?.value === "1";
  return { handle, key, persist, binding: signNoteBinding(handle, key) };
}

export async function sessionNotePage(
  handle: string
): Promise<PageNoteSession | null> {
  if (!isSessionHandle(handle)) return null;
  const store = await cookies();
  const key = normalizeKey(store.get(sessionKeyCookieName(handle))?.value);
  if (!key) return null;
  const persist = store.get(PERSIST_COOKIE)?.value === "1";
  return { handle, key, persist, binding: signNoteBinding(handle, key) };
}
