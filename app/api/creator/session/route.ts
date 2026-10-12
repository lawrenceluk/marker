import { NextRequest, NextResponse } from "next/server";
import { applyNoIndexHeaders } from "@/app/lib/robots";
import { CREATOR_COOKIE, creatorCookieOptions, normalizeCreatorId } from "@/app/lib/creatorId";
import { checkCreator, clientFingerprint } from "@/app/lib/creators";

/**
 * Adopt a pasted creator id as the `/c` cookie. Accepts the `/c` HTML form
 * (redirects back) or JSON (`{creator_id}` → JSON). The id is validated
 * against Redis first so a typo never becomes a sticky cookie.
 */
export async function POST(request: NextRequest) {
  const isForm = !(request.headers.get("content-type") ?? "").includes("application/json");
  let raw: unknown;
  let forget = false;
  try {
    if (isForm) {
      const form = await request.formData();
      raw = form.get("creator_id");
      forget = form.get("forget") === "1";
    } else {
      const body = await request.json();
      raw = body?.creator_id;
    }
  } catch {
    return respond(isForm, request, { error: "invalid" }, 400);
  }

  if (forget) {
    const response = respond(isForm, request, { success: true }, 200);
    response.cookies.set(CREATOR_COOKIE, "", creatorCookieOptions(0));
    return response;
  }

  const id = normalizeCreatorId(raw);
  if (!id) return respond(isForm, request, { error: "invalid" }, 400);

  const status = await checkCreator(id, clientFingerprint(request.headers));
  if (status === "limited") return respond(isForm, request, { error: "limited" }, 429);
  if (status === "not_found") return respond(isForm, request, { error: "not_found" }, 404);

  const response = respond(isForm, request, { success: true }, 200);
  response.cookies.set(CREATOR_COOKIE, id, creatorCookieOptions());
  return response;
}

/** Forget the creator id in this browser. */
export async function DELETE() {
  const response = NextResponse.json({ success: true });
  applyNoIndexHeaders(response.headers);
  response.cookies.set(CREATOR_COOKIE, "", creatorCookieOptions(0));
  return response;
}

function respond(isForm: boolean, request: NextRequest, data: { error?: string; success?: boolean }, status: number) {
  let response: NextResponse;
  if (isForm) {
    const url = new URL("/c", request.url);
    if (data.error) url.searchParams.set("error", data.error);
    response = NextResponse.redirect(url, 303);
  } else {
    response = NextResponse.json(data, { status });
  }
  applyNoIndexHeaders(response.headers);
  return response;
}
