import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, normalizeKey, sessionCookieOptions } from "@/app/lib/key";

export const config = { matcher: "/" };

export function proxy(request: NextRequest) {
  const key = normalizeKey(request.nextUrl.searchParams.get("key"));

  if (!key) {
    return withPrivateCaching(NextResponse.next());
  }

  // Move the key out of the URL and into an httpOnly cookie, then redirect to
  // the clean path. After this the secret is never in the address bar, browser
  // history, a Referer header, or the client-side JS — and the page can render
  // the note server-side instead of showing a key prompt to anything that
  // fetches the URL directly.
  const url = request.nextUrl.clone();
  url.searchParams.delete("key");

  const response = NextResponse.redirect(url);
  response.cookies.set(SESSION_COOKIE, key, sessionCookieOptions());
  return withPrivateCaching(response);
}

/** Note content is per-cookie and secret; nothing may cache this page. */
function withPrivateCaching(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store, private");
  return response;
}
