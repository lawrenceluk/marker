import { NextRequest, NextResponse } from "next/server";
import { applyNoIndexHeaders } from "@/app/lib/robots";
import { CREATOR_COOKIE, creatorCookieOptions, normalizeCreatorId } from "@/app/lib/creatorId";
import { checkCreator, clientFingerprint } from "@/app/lib/creators";
import { activateFolder } from "@/app/lib/folders";

/**
 * Second hop of a `/c?token=` link: the proxy already moved the id into the
 * folder cookie. Confirm the creator exists before remembering it for the
 * home page, so a mistyped link never sticks. One EVAL.
 */
export async function GET(request: NextRequest) {
  const id = normalizeCreatorId(request.cookies.get(CREATOR_COOKIE)?.value);
  const status = id ? await checkCreator(id, clientFingerprint(request.headers)) : "not_found";

  let location = `/c${request.nextUrl.search}`;
  if (status !== "ok") location = `/c?error=${status === "limited" ? "limited" : "not_found"}`;
  // Relative, so the redirect stays on the public origin behind any proxy.
  const response = new NextResponse(null, { status: 303, headers: { Location: location } });
  if (id && status === "ok") activateFolder(request.cookies, response.cookies, id);
  else response.cookies.set(CREATOR_COOKIE, "", creatorCookieOptions(0));
  applyNoIndexHeaders(response.headers);
  return response;
}
