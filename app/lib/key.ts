/**
 * The note key and how it is carried between requests.
 *
 * Deliberately free of any Redis import: middleware runs on the edge runtime
 * and pulls this module in, so it must stay dependency-light.
 */

export const MAX_KEY_LENGTH = 512;

/** Name of the httpOnly cookie holding the active note key. */
export const SESSION_COOKIE = "marker_key";

/**
 * Companion cookie that marks the current session as a persistent document
 * link. The key cookie's maxAge cannot be read back, so this flag is how the
 * server and UI know persist is on.
 */
export const PERSIST_COOKIE = "marker_persist";

/** Query param that opts a `/?key=` link into staying in the address bar. */
export const PERSIST_QUERY = "persist";

/** How long a persistent key cookie lasts — matches the note TTL ceiling. */
export const PERSIST_MAX_AGE = 60 * 60 * 24 * 365;

export function normalizeKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const key = raw.trim();
  if (!key || key.length > MAX_KEY_LENGTH) return null;
  return key;
}

/**
 * A display label for a key. The browser is never given the key itself, so
 * this is all the UI has to show which note is open.
 */
export function maskKey(key: string): string {
  return key.length > 8 ? `****${key.slice(-4)}` : "****";
}

export function isPersistParam(raw: unknown): boolean {
  if (raw === true) return true;
  if (typeof raw !== "string") return false;
  const value = raw.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

/**
 * Relative document URL for a key. Visiting it loads the note and keeps the
 * key in the address bar — unlike the one-off `/?key=` share, which the
 * proxy strips into a session cookie.
 */
export function persistPath(key: string): string {
  const params = new URLSearchParams();
  params.set("key", key);
  params.set(PERSIST_QUERY, "1");
  return `/?${params.toString()}`;
}

/**
 * Session cookie options. Persist sets a maxAge so the note survives a
 * browser restart; without it the cookie dies with the window — the key is
 * the note's only secret, so it shouldn't outlive the window it was opened
 * in unless the user opted into a document link.
 */
export function sessionCookieOptions(persist = false) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    ...(persist ? { maxAge: PERSIST_MAX_AGE } : {}),
  };
}

type CookieSetter = {
  set: (
    name: string,
    value: string,
    options: ReturnType<typeof sessionCookieOptions> & { maxAge?: number }
  ) => void;
};

/** Write or clear the pair of session cookies that carry the key and persist flag. */
export function applySessionCookies(
  cookies: CookieSetter,
  key: string,
  persist: boolean
) {
  cookies.set(SESSION_COOKIE, key, sessionCookieOptions(persist));
  if (persist) {
    cookies.set(PERSIST_COOKIE, "1", sessionCookieOptions(true));
  } else {
    cookies.set(PERSIST_COOKIE, "", { ...sessionCookieOptions(false), maxAge: 0 });
  }
}

export function clearSessionCookies(cookies: CookieSetter) {
  const cleared = { ...sessionCookieOptions(false), maxAge: 0 };
  cookies.set(SESSION_COOKIE, "", cleared);
  cookies.set(PERSIST_COOKIE, "", cleared);
}
