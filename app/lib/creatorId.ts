/**
 * Creator ids, names and tags: validation and the browser cookie.
 *
 * Like `key.ts`, this stays free of Redis and Node imports because the edge
 * proxy pulls it in to move `/c?token=` into a cookie.
 */

/** httpOnly cookie holding the raw creator id for the `/c` folder view. */
export const CREATOR_COOKIE = "marker_creator";

/** Query param on `/c` that the proxy moves into `CREATOR_COOKIE`. */
export const CREATOR_QUERY = "token";

export const CREATOR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const CREATOR_ID_MIN_LENGTH = 22;
export const CREATOR_ID_MAX_LENGTH = 128;
export const CREATOR_NAME_MAX_LENGTH = 80;
export const MAX_TAGS = 10;

const CREATOR_ID_PATTERN = /^[A-Za-z0-9_~-]+$/;
const TAG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/** A creator id is a high-entropy secret; anything short or off-alphabet is rejected. */
export function normalizeCreatorId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const id = raw.trim();
  if (id.length < CREATOR_ID_MIN_LENGTH || id.length > CREATOR_ID_MAX_LENGTH) return null;
  return CREATOR_ID_PATTERN.test(id) ? id : null;
}

/** 24 random bytes as base64url: 32 characters, 192 bits. */
export function generateCreatorId(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function normalizeCreatorName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  if (!name || [...name].length > CREATOR_NAME_MAX_LENGTH || CONTROL_CHARS.test(name)) return null;
  return name;
}

export function normalizeTag(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const tag = raw.trim().toLowerCase();
  return TAG_PATTERN.test(tag) ? tag : null;
}

/** Sorted, deduplicated tags, or an error message. Invalid input is never dropped silently. */
export function normalizeTags(raw: unknown): { tags: string[] } | { error: string } {
  if (raw === null) return { tags: [] };
  if (!Array.isArray(raw)) return { error: "tags must be an array of strings or null" };
  const tags = new Set<string>();
  for (const item of raw) {
    const tag = normalizeTag(item);
    if (!tag) {
      return {
        error: `Invalid tag ${JSON.stringify(item)}: tags are 1–32 characters of a-z, 0-9, "_" or "-", starting with a letter or digit`,
      };
    }
    tags.add(tag);
  }
  if (tags.size > MAX_TAGS) return { error: `A note can have at most ${MAX_TAGS} tags` };
  return { tags: [...tags].sort() };
}

/** Same flags as the note session cookie, but long-lived: it is a bookmark for the folder. */
export function creatorCookieOptions(maxAge = CREATOR_COOKIE_MAX_AGE) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}
