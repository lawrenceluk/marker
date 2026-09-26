import { NextRequest, NextResponse } from "next/server";
import { normalizeKey, SESSION_COOKIE } from "@/app/lib/key";
import { readRevision } from "@/app/lib/notes";
import { applyNoIndexHeaders } from "@/app/lib/robots";

export async function GET(request: NextRequest) {
  const key = normalizeKey(request.nextUrl.searchParams.get("key")) ??
    normalizeKey(request.cookies.get(SESSION_COOKIE)?.value);
  const response = key
    ? NextResponse.json({ rev: await readRevision(key) })
    : NextResponse.json({ error: "Key is required" }, { status: 400 });
  applyNoIndexHeaders(response.headers);
  return response;
}
