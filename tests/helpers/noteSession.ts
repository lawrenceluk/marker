import {
  NOTE_BINDING_HEADER,
  generateSessionHandle,
  sessionKeyCookieName,
  signNoteBinding,
} from "../../app/lib/noteSession";

export function browserNoteSession(key: string) {
  const handle = generateSessionHandle();
  const binding = signNoteBinding(handle, key);
  return {
    handle,
    binding,
    headers: {
      cookie: `${sessionKeyCookieName(handle)}=${key}`,
      [NOTE_BINDING_HEADER]: binding,
    } as Record<string, string>,
  };
}
