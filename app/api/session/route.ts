import { NextRequest, NextResponse } from "next/server";
import { normalizeKey } from "@/app/lib/key";
import {
  NOTE_BINDING_HEADER,
  applyHandleSessionCookie,
  clearHandleSessionCookie,
  findHandleForKey,
  generateSessionHandle,
  parseNoteBinding,
  parseSessionOrder,
  persistFromCookie,
  sessionKeyCookieName,
  signNoteBinding,
  SESSION_ORDER_COOKIE,
} from "@/app/lib/noteSession";
import { applyNoIndexHeaders } from "@/app/lib/robots";

function json(data: unknown, status = 200) {
  const response = NextResponse.json(data, { status });
  applyNoIndexHeaders(response.headers);
  return response;
}

function sessionBody(key: string, persist: boolean, handle: string) {
  return {
    persist,
    handle,
    binding: signNoteBinding(handle, key),
    ...(persist ? { key } : {}),
  };
}

function handleFromRequest(request: NextRequest): string | null {
  const parsed = parseNoteBinding(request.headers.get(NOTE_BINDING_HEADER));
  return parsed?.handle ?? null;
}

/** Restore persist state (and the key, when persist is on) after a reload. */
export async function GET(request: NextRequest) {
  const handle = handleFromRequest(request);
  if (!handle) {
    return json({ persist: false });
  }
  const key = normalizeKey(request.cookies.get(sessionKeyCookieName(handle))?.value);
  if (!key) {
    return json({ persist: false });
  }
  const persist = persistFromCookie(request, handle);
  return json(sessionBody(key, persist, handle));
}

/** Adopt a key typed into the browser, so a reload doesn't lose it. */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const existingHandle = handleFromRequest(request);
  const cookieKey = existingHandle
    ? normalizeKey(request.cookies.get(sessionKeyCookieName(existingHandle))?.value)
    : null;
  const bodyKey = normalizeKey(body.key);
  const key = bodyKey ?? cookieKey;
  if (!key) {
    return json({ error: "Key is required" }, 400);
  }

  let persist = existingHandle
    ? persistFromCookie(request, existingHandle)
    : false;
  if (body.persist === true) persist = true;
  if (body.persist === false) persist = false;
  if (bodyKey && body.persist === undefined) persist = false;

  const handle = bodyKey
    ? (findHandleForKey(request.cookies, key) ?? generateSessionHandle())
    : existingHandle ?? generateSessionHandle();
  const response = json(sessionBody(key, persist, handle));
  applyHandleSessionCookie(response.cookies, request.cookies, handle, key, persist);
  return response;
}

/** Backs "Change Key" — only the server can drop the session cookies. */
export async function DELETE(request: NextRequest) {
  const handle = handleFromRequest(request);
  const response = json({ success: true });
  if (handle) {
    const order = parseSessionOrder(
      request.cookies.get(SESSION_ORDER_COOKIE)?.value
    ).filter((h) => h !== handle);
    clearHandleSessionCookie(response.cookies, handle, order);
  } else {
    clearHandleSessionCookie(response.cookies, null);
  }
  return response;
}
