import { NextRequest, NextResponse } from "next/server";
import { normalizeKey } from "@/app/lib/key";
import {
  applyHandleSessionCookie,
  clearHandleSessionCookie,
  findHandleForKey,
  generateSessionHandle,
  parseSessionOrder,
  resolveBrowserSession,
  SESSION_ORDER_COOKIE,
  signNoteBinding,
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

/** Restore persist state (and the key, when persist is on) after a reload. */
export async function GET(request: NextRequest) {
  const resolved = resolveBrowserSession(request);
  if (!resolved.ok) {
    return json(resolved.body, resolved.status);
  }
  const { key, persist, handle } = resolved;
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

  const existing = resolveBrowserSession(request);
  const existingHandle = existing.ok ? existing.handle : null;
  const cookieKey = existing.ok ? existing.key : null;
  const bodyKey = normalizeKey(body.key);
  const key = bodyKey ?? cookieKey;
  if (!key) {
    return json({ error: "Key is required" }, 400);
  }

  let persist = existing.ok ? existing.persist : false;
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
  const resolved = resolveBrowserSession(request);
  if (!resolved.ok) {
    return json(resolved.body, resolved.status);
  }
  const order = parseSessionOrder(
    request.cookies.get(SESSION_ORDER_COOKIE)?.value
  ).filter((h) => h !== resolved.handle);
  const response = json({ success: true });
  clearHandleSessionCookie(response.cookies, resolved.handle, order);
  return response;
}
