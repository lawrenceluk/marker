import { NextRequest, NextResponse } from "next/server";
import {
  PERSIST_COOKIE,
  SESSION_COOKIE,
  applySessionCookies,
  generateRandomKey,
  normalizeKey,
} from "@/app/lib/key";
import { duplicateNote } from "@/app/lib/duplicate";
import { readNote } from "@/app/lib/notes";
import { applyNoIndexHeaders } from "@/app/lib/robots";
import { r2Config } from "@/app/lib/r2";

function json(data: unknown, status = 200) {
  const response = NextResponse.json(data, { status });
  applyNoIndexHeaders(response.headers);
  response.headers.set("Cache-Control", "no-store, private");
  return response;
}

const RANDOMIZE_ATTEMPTS = 16;

export async function POST(request: NextRequest) {
  const sourceKey = normalizeKey(request.cookies.get(SESSION_COOKIE)?.value);
  if (!sourceKey) {
    return json({ error: "Key is required" }, 400);
  }

  const source = await readNote(sourceKey, true);
  if (!source) {
    return json({ error: "Note not found" }, 404);
  }

  const config = r2Config();
  const persist = request.cookies.get(PERSIST_COOKIE)?.value === "1";

  for (let attempt = 0; attempt < RANDOMIZE_ATTEMPTS; attempt++) {
    const destKey = generateRandomKey();
    const result = await duplicateNote(sourceKey, destKey, config, source);
    if (result.ok) {
      const response = json({ success: true, key: destKey });
      applySessionCookies(response.cookies, destKey, persist);
      return response;
    }
    if (result.reason !== "exists") {
      const message =
        result.reason === "not_found"
          ? "Note not found"
          : result.reason === "storage_full"
            ? "Image storage is full. Duplication is paused."
            : result.reason === "too_large"
              ? "This note is too large to duplicate."
              : "Couldn't duplicate note. Try again.";
      const status =
        result.reason === "not_found"
          ? 404
          : result.reason === "storage_full"
            ? 507
            : result.reason === "too_large"
              ? 413
              : 502;
      return json({ error: message }, status);
    }
  }

  return json({ error: "Couldn't duplicate note. Try again." }, 500);
}
