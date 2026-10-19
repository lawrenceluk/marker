import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import {
  PERSIST_COOKIE,
  SESSION_COOKIE,
  normalizeKey,
  sessionCookieOptions,
} from "@/app/lib/key";

/** Client and server send this on browser note API calls to bind the tab to one note. */
export const NOTE_BINDING_HEADER = "X-Marker-Note";

export const NOTE_SWITCHED_CODE = "note_switched";

const HANDLE_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function sessionSecret(): string {
  return (
    process.env.MARKER_REF_SECRET ||
    process.env.KV_REST_API_TOKEN ||
    "marker-ref"
  );
}

/** httpOnly cookie holding the note key for one browser tab session. */
export function sessionKeyCookieName(handle: string): string {
  return `marker_sk_${handle}`;
}

/** Points at the active per-tab handle for this navigation. */
export const SESSION_HANDLE_COOKIE = "marker_sid";

/** Cryptographically random per-tab handle (cookie-safe). */
export function generateSessionHandle(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += HANDLE_ALPHABET[bytes[i]! % HANDLE_ALPHABET.length]!;
  }
  return out;
}

export function isSessionHandle(raw: string): boolean {
  return /^[A-Za-z0-9_-]{12,32}$/.test(raw);
}

/** Opaque binding the page hands to client JS; never contains the raw key. */
export function signNoteBinding(handle: string, key: string): string {
  const mac = createHmac("sha256", sessionSecret())
    .update(`${handle}\n${key}`)
    .digest("base64url")
    .slice(0, 22);
  return `${handle}.${mac}`;
}

export function parseNoteBinding(
  raw: string | null | undefined
): { handle: string; mac: string } | null {
  if (!raw || typeof raw !== "string") return null;
  const dot = raw.indexOf(".");
  if (dot <= 0) return null;
  const handle = raw.slice(0, dot);
  const mac = raw.slice(dot + 1);
  if (!isSessionHandle(handle) || mac.length < 16) return null;
  return { handle, mac };
}

function bindingMac(handle: string, key: string): string {
  return signNoteBinding(handle, key).slice(handle.length + 1);
}

export function verifyNoteBinding(
  handle: string,
  key: string,
  mac: string
): boolean {
  const expected = bindingMac(handle, key);
  if (expected.length !== mac.length) return false;
  try {
    return timingSafeEqual(Buffer.from(mac), Buffer.from(expected));
  } catch {
    return false;
  }
}

export type ResolvedNoteKey =
  | { ok: true; key: string; handle: string | null; browser: boolean }
  | {
      ok: false;
      status: 400 | 409;
      code?: typeof NOTE_SWITCHED_CODE;
      error: string;
    };

/**
 * Resolve the note key for an API request. Agents pass an explicit key; browser
 * tabs pass X-Marker-Note plus the matching per-handle session cookie.
 */
export function resolveNoteKey(
  request: NextRequest,
  explicit: unknown
): ResolvedNoteKey {
  const explicitKey = normalizeKey(explicit);
  if (explicitKey) {
    return { ok: true, key: explicitKey, handle: null, browser: false };
  }

  const parsed = parseNoteBinding(request.headers.get(NOTE_BINDING_HEADER));
  if (!parsed) {
    return { ok: false, status: 400, error: "Key is required" };
  }

  const cookieKey = normalizeKey(
    request.cookies.get(sessionKeyCookieName(parsed.handle))?.value
  );
  if (!cookieKey || !verifyNoteBinding(parsed.handle, cookieKey, parsed.mac)) {
    return {
      ok: false,
      status: 409,
      code: NOTE_SWITCHED_CODE,
      error: "Note changed in another tab",
    };
  }

  return {
    ok: true,
    key: cookieKey,
    handle: parsed.handle,
    browser: true,
  };
}

export function noteSwitchedBody() {
  return { code: NOTE_SWITCHED_CODE, error: "Note changed in another tab" };
}

type CookieSetter = {
  set: (
    name: string,
    value: string,
    options: ReturnType<typeof sessionCookieOptions> & { maxAge?: number }
  ) => void;
};

export function applyHandleSessionCookie(
  cookies: CookieSetter,
  handle: string,
  key: string,
  persist: boolean
) {
  cookies.set(sessionKeyCookieName(handle), key, sessionCookieOptions(persist));
  cookies.set(SESSION_HANDLE_COOKIE, handle, sessionCookieOptions(persist));
  if (persist) {
    cookies.set(PERSIST_COOKIE, "1", sessionCookieOptions(true));
  } else {
    cookies.set(PERSIST_COOKIE, "", {
      ...sessionCookieOptions(false),
      maxAge: 0,
    });
  }
  cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(false), maxAge: 0 });
}

export function clearHandleSessionCookie(
  cookies: CookieSetter,
  handle: string | null
) {
  const cleared = { ...sessionCookieOptions(false), maxAge: 0 };
  if (handle) {
    cookies.set(sessionKeyCookieName(handle), "", cleared);
  }
  cookies.set(SESSION_HANDLE_COOKIE, "", cleared);
  cookies.set(SESSION_COOKIE, "", cleared);
  cookies.set(PERSIST_COOKIE, "", cleared);
}

export function persistFromCookie(request: NextRequest): boolean {
  return request.cookies.get(PERSIST_COOKIE)?.value === "1";
}

/** JSON helper for routes: map resolve failures to responses. */
export function resolvedKeyOrNull(
  request: NextRequest,
  explicit: unknown
): string | null {
  const resolved = resolveNoteKey(request, explicit);
  return resolved.ok ? resolved.key : null;
}

export type ResolveFailure = Extract<ResolvedNoteKey, { ok: false }>;

export function isNoteSwitchedFailure(
  failure: ResolveFailure
): failure is ResolveFailure & { code: typeof NOTE_SWITCHED_CODE } {
  return failure.code === NOTE_SWITCHED_CODE;
}
