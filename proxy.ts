import { NextRequest, NextResponse } from "next/server";
import {
  PERSIST_QUERY,
  applySessionCookies,
  isPersistParam,
  normalizeKey,
} from "@/app/lib/key";

export const config = { matcher: "/" };

export function proxy(request: NextRequest) {
  const key = normalizeKey(request.nextUrl.searchParams.get("key"));

  if (!key) {
    return withPrivateCaching(NextResponse.next());
  }

  const persist = isPersistParam(request.nextUrl.searchParams.get(PERSIST_QUERY));

  if (persist) {
    // Document link: leave `/?key=&persist=1` in the address bar so it can
    // be bookmarked, and make the session cookie survive a browser restart.
    const response = NextResponse.next();
    applySessionCookies(response.cookies, key, true);
    return withPrivateCaching(response);
  }

  // One-off share: move the key out of the URL and into an httpOnly session
  // cookie, then redirect to the clean path. After this the secret is never
  // in the address bar, browser history, a Referer header, or the
  // client-side JS — and the page can render the note server-side instead of
  // showing a key prompt to anything that fetches the URL directly.
  const url = request.nextUrl.clone();
  url.searchParams.delete("key");
  url.searchParams.delete(PERSIST_QUERY);

  const response = NextResponse.redirect(url);
  applySessionCookies(response.cookies, key, false);
  return withPrivateCaching(response);
}

/** Note content is per-cookie and secret; nothing may cache this page. */
function withPrivateCaching(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store, private");
  return response;
}
