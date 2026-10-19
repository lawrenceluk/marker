import { cookies, headers } from "next/headers";
import { normalizeKey } from "@/app/lib/key";
import {
  PAGE_HANDLE_HEADER,
  findHandleForKey,
  isSessionHandle,
  persistCookieName,
  sessionKeyCookieName,
  signNoteBinding,
} from "@/app/lib/noteSession";

export type PageNoteSession = {
  binding: string;
  handle: string;
  key: string;
  persist: boolean;
};

function loadPageSession(
  store: Awaited<ReturnType<typeof cookies>>,
  handle: string,
  expectedKey?: string | null
): PageNoteSession | null {
  if (!isSessionHandle(handle)) return null;
  const key = normalizeKey(store.get(sessionKeyCookieName(handle))?.value);
  if (!key) return null;
  if (expectedKey && key !== expectedKey) return null;
  const persist = store.get(persistCookieName(handle))?.value === "1";
  return { handle, key, persist, binding: signNoteBinding(handle, key) };
}

export async function readPageNoteSession(
  expectedKey?: string | null
): Promise<PageNoteSession | null> {
  const store = await cookies();
  const fromProxy = (await headers()).get(PAGE_HANDLE_HEADER);
  if (fromProxy && isSessionHandle(fromProxy)) {
    return loadPageSession(store, fromProxy, expectedKey);
  }
  if (expectedKey) {
    const handle = findHandleForKey(store, expectedKey);
    if (handle) return loadPageSession(store, handle, expectedKey);
  }
  return null;
}

export async function sessionNotePage(
  handle: string
): Promise<PageNoteSession | null> {
  const store = await cookies();
  return loadPageSession(store, handle);
}
