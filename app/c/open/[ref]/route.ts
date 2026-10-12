import { NextRequest, NextResponse } from "next/server";
import { applySessionCookies } from "@/app/lib/key";
import { applyNoIndexHeaders } from "@/app/lib/robots";
import { clientFingerprint, requestCreatorId, resolveNoteRef } from "@/app/lib/creators";

/**
 * Open a folder row: resolve the opaque ref against the creator's index,
 * put the note key in the session cookie, and land on `/n` — the same
 * one-off session a `/?key=` share produces. The key never reaches the URL.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const id = requestCreatorId(request);
  const result = id
    ? await resolveNoteRef(id, ref, clientFingerprint(request.headers))
    : { status: "not_found" as const };

  const target = result.status === "ok" ? "/n" : `/c?error=${result.status === "limited" ? "limited" : "missing_note"}`;
  // Relative, so the redirect stays on the public origin behind any proxy.
  const response = new NextResponse(null, { status: 303, headers: { Location: target } });
  if (result.status === "ok") applySessionCookies(response.cookies, result.key, false);
  applyNoIndexHeaders(response.headers);
  return response;
}
