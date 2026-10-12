import { NextRequest, NextResponse } from "next/server";
import {
  PERSIST_QUERY,
  applySessionCookies,
  isPersistParam,
  normalizeKey,
} from "@/app/lib/key";
import { ROBOTS_TAG } from "@/app/lib/robots";
import {
  CREATOR_COOKIE,
  CREATOR_QUERY,
  creatorCookieOptions,
  normalizeCreatorId,
} from "@/app/lib/creatorId";

export const config = { matcher: ["/", "/n", "/c"] };

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === "/c") return creatorFolder(request);
  if (request.nextUrl.pathname === "/n") return withPrivateCaching(NextResponse.next());

  const key = normalizeKey(request.nextUrl.searchParams.get("key"));

  if (!key) {
    return withPrivateCaching(NextResponse.next());
  }

  const persist = isPersistParam(request.nextUrl.searchParams.get(PERSIST_QUERY));

  if (persist) {
    // Document link: leave `/?key=&persist=1` in the address bar so it can
    // be bookmarked, and make the session cookie survive a browser restart.
    // Chat unfurlers fetch this URL; the page emits OG tags from the note prefix.
    const response = NextResponse.next();
    applySessionCookies(response.cookies, key, true);
    return withPrivateCaching(response);
  }

  // One-off share: move the key out of the URL and into an httpOnly session
  // cookie, then redirect to the clean `/n` note view. After this the secret
  // is never in the address bar, browser history, a Referer header, or the
  // client-side JS — and the page can render the note server-side instead of
  // showing a key prompt to anything that fetches the URL directly. `/`
  // itself never reads the session cookie, so it always opens on Home.
  const url = request.nextUrl.clone();
  url.pathname = "/n";
  url.searchParams.delete("key");
  url.searchParams.delete(PERSIST_QUERY);

  const response = NextResponse.redirect(url);
  applySessionCookies(response.cookies, key, false);
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
