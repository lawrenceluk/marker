import { NextRequest, NextResponse } from "next/server";
import {
  PERSIST_COOKIE,
  SESSION_COOKIE,
  applySessionCookies,
  clearSessionCookies,
  normalizeKey,
} from "@/app/lib/key";
import { applyNoIndexHeaders } from "@/app/lib/robots";

function json(data: unknown, status = 200) {
  const response = NextResponse.json(data, { status });
  applyNoIndexHeaders(response.headers);
  return response;
}

function persistFromCookie(request: NextRequest): boolean {
  return request.cookies.get(PERSIST_COOKIE)?.value === "1";
}

function sessionBody(key: string, persist: boolean) {
  // The raw key is only returned once the user has opted into a document
  // link — that's the same secret they just chose to keep in the URL.
  return persist ? { persist: true, key } : { persist: false };
}

/** Restore persist state (and the key, when persist is on) after a reload. */
export async function GET(request: NextRequest) {
  const key = normalizeKey(request.cookies.get(SESSION_COOKIE)?.value);
  if (!key) {
    return json({ persist: false });
  }

  const persist = persistFromCookie(request);
  return json(sessionBody(key, persist));
}

/** Adopt a key typed into the browser, so a reload doesn't lose it. */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const cookieKey = normalizeKey(request.cookies.get(SESSION_COOKIE)?.value);
  const bodyKey = normalizeKey(body.key);
  const key = bodyKey ?? cookieKey;
  if (!key) {
    return json({ error: "Key is required" }, 400);
  }

  // A newly typed key is a one-off session unless persist is explicitly on.
  // Toggling persist on an existing session is `POST { persist }` with no key.
  let persist = persistFromCookie(request);
  if (body.persist === true) persist = true;
  if (body.persist === false) persist = false;
  if (bodyKey && body.persist === undefined) persist = false;

  const response = json(sessionBody(key, persist));
  applySessionCookies(response.cookies, key, persist);
  return response;
}

/** Backs "Change Key" — the cookie is httpOnly, so only the server can drop it. */
export async function DELETE() {
  const response = json({ success: true });
  clearSessionCookies(response.cookies);
  return response;
}
