import { NextRequest, NextResponse } from "next/server";
import {
  applyHandleSessionCookie,
  findHandleForKey,
  generateSessionHandle,
} from "@/app/lib/noteSession";
import { applyNoIndexHeaders } from "@/app/lib/robots";
import { clientFingerprint, requestCreatorId, resolveNoteRef } from "@/app/lib/creators";

/**
 * Resolve a folder list row: match the opaque ref against the creator's index,
 * put the note key in the session cookie, and land on `/n` — the same
 * one-off session a `/?key=` share produces. The key never reaches the URL.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const id = requestCreatorId(request);
  const result = id
    ? await resolveNoteRef(id, ref, clientFingerprint(request.headers))
    : { status: "not_found" as const };

  if (result.status !== "ok") {
    const target = `/c?error=${result.status === "limited" ? "limited" : "missing_note"}`;
    const response = new NextResponse(null, { status: 303, headers: { Location: target } });
    applyNoIndexHeaders(response.headers);
    return response;
  }

  const handle =
    findHandleForKey(request.cookies, result.key) ?? generateSessionHandle();
  const response = new NextResponse(null, {
    status: 303,
    headers: { Location: `/n/${handle}` },
  });
  applyHandleSessionCookie(
    response.cookies,
    request.cookies,
    handle,
    result.key,
    false
  );
  applyNoIndexHeaders(response.headers);
  return response;
}
