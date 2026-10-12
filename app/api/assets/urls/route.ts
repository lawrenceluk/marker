import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, normalizeKey } from "@/app/lib/key";
import { applyNoIndexHeaders } from "@/app/lib/robots";
import { r2Config } from "@/app/lib/r2";
import { assetUrls } from "@/app/lib/assets";
import { readNote } from "@/app/lib/notes";

function json(data: unknown, status = 200) {
  const response = NextResponse.json(data, { status });
  applyNoIndexHeaders(response.headers);
  response.headers.set("Cache-Control", "no-store, private");
  return response;
}

/** Fresh view URLs for a note's images, for a page open past their expiry. JSON only; one EVAL. */
export async function GET(request: NextRequest) {
  const config = r2Config();
  if (!config) return json({ error: "Images are not configured on this deployment", urls: {} }, 503);
  const key = normalizeKey(request.nextUrl.searchParams.get("key")) ?? normalizeKey(request.cookies.get(SESSION_COOKIE)?.value);
  if (!key) return json({ error: "Key is required" }, 400);
  const note = await readNote(key);
  const urls = note ? assetUrls(config, note) : {};
  return json({ urls: Object.fromEntries(Object.entries(urls).map(([id, u]) => [id, u.url])), expires_at: Object.values(urls)[0]?.expires_at ?? null });
}
