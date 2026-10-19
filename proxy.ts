import { NextRequest, NextResponse } from "next/server";
import {
  PERSIST_QUERY,
  isPersistParam,
  normalizeKey,
  SESSION_COOKIE,
} from "@/app/lib/key";
import {
  applyHandleSessionCookie,
  generateSessionHandle,
  isSessionHandle,
} from "@/app/lib/noteSession";
import { ROBOTS_TAG } from "@/app/lib/robots";
import {
  CREATOR_COOKIE,
  CREATOR_QUERY,
  creatorCookieOptions,
  normalizeCreatorId,
} from "@/app/lib/creatorId";

export const config = { matcher: ["/", "/n", "/n/:handle", "/c"] };

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === "/c") return creatorFolder(request);
  if (request.nextUrl.pathname === "/n") return legacySessionNote(request);
  if (request.nextUrl.pathname.startsWith("/n/")) {
    const handle = request.nextUrl.pathname.slice(3);
    if (!isSessionHandle(handle)) {
      return withPrivateCaching(NextResponse.redirect(new URL("/", request.url)));
    }
    return withPrivateCaching(NextResponse.next());
  }

  const key = normalizeKey(request.nextUrl.searchParams.get("key"));

  if (!key) {
    return withPrivateCaching(NextResponse.next());
  }

  const persist = isPersistParam(request.nextUrl.searchParams.get(PERSIST_QUERY));

  if (persist) {
    // Document link: leave `/?key=&persist=1` in the address bar so it can
    // be bookmarked, and make the session cookie survive a browser restart.
    // Chat unfurlers fetch this URL; the page emits OG tags from the note prefix.
    const handle = generateSessionHandle();
    const response = NextResponse.next();
    applyHandleSessionCookie(response.cookies, handle, key, true);
    return withPrivateCaching(response);
  }

  // One-off share: move the key out of the URL and into a per-tab session
  // cookie, then redirect to `/n/<handle>`. After this the secret is never in
  // the address bar, browser history, a Referer header, or client-side JS.
  const handle = generateSessionHandle();
  const url = request.nextUrl.clone();
  url.pathname = `/n/${handle}`;
  url.searchParams.delete("key");
  url.searchParams.delete(PERSIST_QUERY);

  const response = NextResponse.redirect(url);
  applyHandleSessionCookie(response.cookies, handle, key, false);
  return withPrivateCaching(response);
}

/** Legacy `/n` with the old single `marker_key` cookie → per-handle session. */
function legacySessionNote(request: NextRequest) {
  const legacyKey = normalizeKey(request.cookies.get(SESSION_COOKIE)?.value);
  if (!legacyKey) {
    return withPrivateCaching(NextResponse.redirect(new URL("/", request.url)));
  }
  const handle = generateSessionHandle();
  const url = request.nextUrl.clone();
  url.pathname = `/n/${handle}`;
  const response = NextResponse.redirect(url);
  const persist = request.cookies.get("marker_persist")?.value === "1";
  applyHandleSessionCookie(response.cookies, handle, legacyKey, persist);
  return withPrivateCaching(response);
}

/**
 * `/c?token=<creator_id>`: same pattern as `/?key=` — move the secret into
 * an httpOnly cookie and redirect without it. `/c/enter` then checks the id
 * against Redis and remembers it for Home. An invalid token is still
 * stripped so it never lingers in history.
 */
function creatorFolder(request: NextRequest) {
  if (!request.nextUrl.searchParams.has(CREATOR_QUERY)) {
    return withPrivateCaching(NextResponse.next());
  }
  const id = normalizeCreatorId(request.nextUrl.searchParams.get(CREATOR_QUERY));
  const url = request.nextUrl.clone();
  url.searchParams.delete(CREATOR_QUERY);
  if (id) url.pathname = "/c/enter";
  else url.searchParams.set("error", "invalid");
  const response = NextResponse.redirect(url);
  if (id) response.cookies.set(CREATOR_COOKIE, id, creatorCookieOptions());
  return withPrivateCaching(response);
}

/** Note content is per-cookie and secret; nothing may cache or index this page. */
function withPrivateCaching(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store, private");
  response.headers.set("X-Robots-Tag", ROBOTS_TAG);
  return response;
}
