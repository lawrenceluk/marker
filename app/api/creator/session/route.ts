import { NextRequest, NextResponse } from "next/server";
import { applyNoIndexHeaders } from "@/app/lib/robots";
import { CREATOR_COOKIE, creatorCookieOptions, normalizeCreatorId } from "@/app/lib/creatorId";
import { checkCreator, clientFingerprint } from "@/app/lib/creators";
import { activateFolder, forgetFolder } from "@/app/lib/folders";

/**
 * Adopt a pasted creator id as the `/c` cookie. Accepts the `/c` HTML form
 * (redirects back) or JSON (`{creator_id}` → JSON). The id is validated
 * against Redis first so a typo never becomes a sticky cookie, and is then
 * remembered for the home page's Folders list.
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
    return respond(isForm, { error: "invalid" }, 400);
  }

  if (forget) {
    const response = respond(isForm, { success: true }, 200);
    response.cookies.set(CREATOR_COOKIE, "", creatorCookieOptions(0));
    const active = normalizeCreatorId(request.cookies.get(CREATOR_COOKIE)?.value);
    if (active) forgetFolder(request.cookies, response.cookies, active);
    return response;
  }

  const id = normalizeCreatorId(raw);
  if (!id) return respond(isForm, { error: "invalid" }, 400);

  const status = await checkCreator(id, clientFingerprint(request.headers));
  if (status === "limited") return respond(isForm, { error: "limited" }, 429);
  if (status === "not_found") return respond(isForm, { error: "not_found" }, 404);

  const response = respond(isForm, { success: true }, 200);
  activateFolder(request.cookies, response.cookies, id);
  return response;
}

/** Stop using the active folder in this browser; it stays in the remembered list. */
export async function DELETE() {
  const response = NextResponse.json({ success: true });
  applyNoIndexHeaders(response.headers);
  response.cookies.set(CREATOR_COOKIE, "", creatorCookieOptions(0));
  return response;
}

function respond(isForm: boolean, data: { error?: string; success?: boolean }, status: number) {
  let response: NextResponse;
  if (isForm) {
    // Relative, so the redirect stays on the public origin behind any proxy.
    const location = data.error ? `/c?error=${encodeURIComponent(data.error)}` : "/c";
    response = new NextResponse(null, { status: 303, headers: { Location: location } });
  } else {
    response = NextResponse.json(data, { status });
  }
  applyNoIndexHeaders(response.headers);
  return response;
}
