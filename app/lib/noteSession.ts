import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import {
  PERSIST_MAX_AGE,
  SESSION_COOKIE,
  normalizeKey,
  sessionCookieOptions,
} from "@/app/lib/key";

/** Client and server send this on browser note API calls to bind the tab to one note. */
export const NOTE_BINDING_HEADER = "X-Marker-Note";

/** Proxy passes the active page handle to the App Router (not stored in a global cookie). */
export const PAGE_HANDLE_HEADER = "x-marker-page-handle";

export const NOTE_SWITCHED_CODE = "note_switched";
export const NOTE_SESSION_EXPIRED_CODE = "note_session_expired";

export const MAX_SESSION_HANDLES = 20;
export const ONE_OFF_MAX_AGE = 60 * 60 * 24 * 7;

export const SESSION_ORDER_COOKIE = "marker_sho";

const HANDLE_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const KEY_PREFIX = "marker_sk_";
const PERSIST_PREFIX = "marker_sp_";

let secretChecked = false;

export function sessionSecret(): string {
  const configured = process.env.MARKER_REF_SECRET;
  const vercelProd = process.env.VERCEL_ENV === "production";
  if (vercelProd) {
    if (!configured) {
      throw new Error(
        "MARKER_REF_SECRET is required in production deployments"
      );
    }
    return configured;
  }
  if (!secretChecked) {
    secretChecked = true;
  }
  return configured || process.env.KV_REST_API_TOKEN || "marker-ref";
}

/** httpOnly cookie holding the note key for one browser tab session. */
export function sessionKeyCookieName(handle: string): string {
  return `${KEY_PREFIX}${handle}`;
}

export function persistCookieName(handle: string): string {
  return `${PERSIST_PREFIX}${handle}`;
}

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

export type CookieReader = {
  get(name: string): { value: string } | undefined;
  getAll?(): { name: string; value: string }[];
};

type CookieSetter = {
  set: (
    name: string,
    value: string,
    options: ReturnType<typeof sessionCookieOptions> & { maxAge?: number }
  ) => void;
};

export function parseSessionOrder(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(",").filter((part) => isSessionHandle(part));
}

export function findHandleForKey(
  cookies: CookieReader,
  key: string
): string | null {
  const all = cookies.getAll?.() ?? [];
  for (const { name, value } of all) {
    if (!name.startsWith(KEY_PREFIX)) continue;
    const handle = name.slice(KEY_PREFIX.length);
    if (!isSessionHandle(handle)) continue;
    if (normalizeKey(value) === key) return handle;
  }
  return null;
}

function handleCookieOptions(persist: boolean) {
  return {
    ...sessionCookieOptions(false),
    maxAge: persist ? PERSIST_MAX_AGE : ONE_OFF_MAX_AGE,
  };
}

function touchOrder(order: string[], handle: string): {
  order: string[];
  evicted: string[];
} {
  const next = order.filter((h) => h !== handle);
  next.push(handle);
  const evicted: string[] = [];
  while (next.length > MAX_SESSION_HANDLES) {
    evicted.push(next.shift()!);
  }
  return { order: next, evicted };
}

export function removeHandleFromOrder(
  cookies: CookieSetter,
  requestCookies: CookieReader,
  handle: string
) {
  const order = parseSessionOrder(
    requestCookies.get(SESSION_ORDER_COOKIE)?.value
  ).filter((h) => h !== handle);
  cookies.set(SESSION_ORDER_COOKIE, order.join(","), handleCookieOptions(true));
}

function clearLegacyGlobals(cookies: CookieSetter) {
  const cleared = { ...sessionCookieOptions(false), maxAge: 0 };
  cookies.set(SESSION_COOKIE, "", cleared);
  cookies.set("marker_persist", "", cleared);
}

export function clearHandleSessionCookie(
  cookies: CookieSetter,
  handle: string | null,
  order?: string[]
) {
  const cleared = { ...sessionCookieOptions(false), maxAge: 0 };
  if (handle) {
    cookies.set(sessionKeyCookieName(handle), "", cleared);
    cookies.set(persistCookieName(handle), "", cleared);
  }
  if (order) {
    cookies.set(SESSION_ORDER_COOKIE, order.join(","), handleCookieOptions(true));
  }
  clearLegacyGlobals(cookies);
}

/** Write per-handle session cookies and maintain the bounded handle order list. */
export function applyHandleSessionCookie(
  cookies: CookieSetter,
  requestCookies: CookieReader,
  handle: string,
  key: string,
  persist: boolean
) {
  const order = parseSessionOrder(requestCookies.get(SESSION_ORDER_COOKIE)?.value);
  const { order: nextOrder, evicted } = touchOrder(order, handle);
  for (const old of evicted) {
    if (old === handle) continue;
    cookies.set(sessionKeyCookieName(old), "", {
      ...sessionCookieOptions(false),
      maxAge: 0,
    });
    cookies.set(persistCookieName(old), "", {
      ...sessionCookieOptions(false),
      maxAge: 0,
    });
  }

  const opts = handleCookieOptions(persist);
  cookies.set(sessionKeyCookieName(handle), key, opts);
  if (persist) {
    cookies.set(persistCookieName(handle), "1", opts);
  } else {
    cookies.set(persistCookieName(handle), "", {
      ...sessionCookieOptions(false),
      maxAge: 0,
    });
  }
  cookies.set(SESSION_ORDER_COOKIE, nextOrder.join(","), handleCookieOptions(true));
  clearLegacyGlobals(cookies);
}

export function ensureHandleSession(
  cookies: CookieSetter,
  requestCookies: CookieReader,
  key: string,
  persist: boolean
): string {
  const handle =
    findHandleForKey(requestCookies, key) ?? generateSessionHandle();
  applyHandleSessionCookie(cookies, requestCookies, handle, key, persist);
  return handle;
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
      code?: typeof NOTE_SWITCHED_CODE | typeof NOTE_SESSION_EXPIRED_CODE;
      error: string;
    };

function sessionExpired(): ResolvedNoteKey {
  return {
    ok: false,
    status: 409,
    code: NOTE_SESSION_EXPIRED_CODE,
    error: "This note was closed",
  };
}

function noteSwitched(): ResolvedNoteKey {
  return {
    ok: false,
    status: 409,
    code: NOTE_SWITCHED_CODE,
    error: "Note changed in another tab",
  };
}

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

  const legacyKey = normalizeKey(request.cookies.get(SESSION_COOKIE)?.value);
  const bindingRaw = request.headers.get(NOTE_BINDING_HEADER);
  if (!bindingRaw) {
    if (legacyKey) return sessionExpired();
    return sessionExpired();
  }

  const parsed = parseNoteBinding(bindingRaw);
  if (!parsed) {
    if (legacyKey) return sessionExpired();
    return sessionExpired();
  }

  const cookieKey = normalizeKey(
    request.cookies.get(sessionKeyCookieName(parsed.handle))?.value
  );
  if (!cookieKey) {
    return sessionExpired();
  }
  if (!verifyNoteBinding(parsed.handle, cookieKey, parsed.mac)) {
    return noteSwitched();
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

export function noteSessionExpiredBody() {
  return { code: NOTE_SESSION_EXPIRED_CODE, error: "This note was closed" };
}

export function persistFromCookie(
  request: NextRequest,
  handle: string
): boolean {
  return request.cookies.get(persistCookieName(handle))?.value === "1";
}

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

export function countSessionHandles(cookies: CookieReader): number {
  const all = cookies.getAll?.() ?? [];
  return all.filter((c) => c.name.startsWith(KEY_PREFIX)).length;
}
