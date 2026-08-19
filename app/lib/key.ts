/**
 * The note key and how it is carried between requests.
 *
 * Deliberately free of any Redis import: middleware runs on the edge runtime
 * and pulls this module in, so it must stay dependency-light.
 */

export const MAX_KEY_LENGTH = 512;

/** Name of the httpOnly cookie holding the active note key. */
export const SESSION_COOKIE = "marker_key";

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

/**
 * A session cookie — no maxAge, so it dies with the browser session. The key
 * is the note's only secret, so it shouldn't outlive the window it was opened
 * in.
 */
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };
}
