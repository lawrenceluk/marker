import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, normalizeKey, sessionCookieOptions } from "@/app/lib/key";

/** Adopt a key typed into the browser, so a reload doesn't lose it. */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const key = normalizeKey(body.key);
  if (!key) {
    return NextResponse.json({ error: "Key is required" }, { status: 400 });
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set(SESSION_COOKIE, key, sessionCookieOptions());
  return response;
}

/** Backs "Change Key" — the cookie is httpOnly, so only the server can drop it. */
export async function DELETE() {
  const response = NextResponse.json({ success: true });
  response.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(), maxAge: 0 });
  return response;
}
