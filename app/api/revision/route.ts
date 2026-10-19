import { NextRequest, NextResponse } from "next/server";
import { requireNoteKey } from "@/app/lib/noteApi";
import { readRevision } from "@/app/lib/notes";
import { applyNoIndexHeaders } from "@/app/lib/robots";

export async function GET(request: NextRequest) {
  const resolved = requireNoteKey(request, request.nextUrl.searchParams.get("key"));
  const response = resolved.ok
    ? NextResponse.json({ rev: await readRevision(resolved.key) })
    : NextResponse.json(resolved.body, { status: resolved.status });
  applyNoIndexHeaders(response.headers);
  return response;
}
