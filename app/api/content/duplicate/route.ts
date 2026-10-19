import { NextRequest, NextResponse } from "next/server";
import { generateRandomKey } from "@/app/lib/key";
import {
  noteSessionExpiredBody,
  noteSwitchedBody,
  resolveNoteKey,
} from "@/app/lib/noteSession";
import { duplicateNote, reserveDuplicateAttempt } from "@/app/lib/duplicate";
import { clientFingerprint, creatorHash, requestCreatorId } from "@/app/lib/creators";
import { readNote } from "@/app/lib/notes";
import { applyNoIndexHeaders } from "@/app/lib/robots";
import { r2Config } from "@/app/lib/r2";
import {
  applyHandleSessionCookie,
  generateSessionHandle,
  persistFromCookie,
  signNoteBinding,
} from "@/app/lib/noteSession";

function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  const response = NextResponse.json(data, { status, headers });
  applyNoIndexHeaders(response.headers);
  response.headers.set("Cache-Control", "no-store, private");
  return response;
}

const RANDOMIZE_ATTEMPTS = 16;

function callerProvesCreator(
  request: NextRequest,
  note: { cid: string | null },
): boolean {
  if (!note.cid) return false;
  const id = requestCreatorId(request);
  return Boolean(id && creatorHash(id) === note.cid);
}

export async function POST(request: NextRequest) {
  // Persist links pass ?key= on API calls for other routes; duplicate must stay on the tab binding.
  const resolved = resolveNoteKey(request, undefined);
  if (!resolved.ok) {
    const body =
      resolved.code === "note_switched"
        ? noteSwitchedBody()
        : resolved.code === "note_session_expired"
          ? noteSessionExpiredBody()
          : { error: resolved.error };
    return json(body, resolved.status);
  }
  if (!resolved.browser || !resolved.handle) {
    return json({ error: "Key is required" }, 400);
  }

  const sourceKey = resolved.key;
  const source = await readNote(sourceKey, true);
  if (!source) {
    return json({ error: "Note not found" }, 404);
  }

  const client = clientFingerprint(request.headers);
  const rate = await reserveDuplicateAttempt(sourceKey, client);
  if (!rate.ok) {
    return json(
      { error: "Too many duplicates for this note. Try again later." },
      429,
      { "Retry-After": String(rate.retryAfter) },
    );
  }

  const config = r2Config();
  const copyCreator = callerProvesCreator(request, source);
  const persist = persistFromCookie(request, resolved.handle);

  for (let attempt = 0; attempt < RANDOMIZE_ATTEMPTS; attempt++) {
    const destKey = generateRandomKey();
    const result = await duplicateNote(sourceKey, destKey, config, source, {
      copyCreator,
    });
    if (result.ok) {
      const handle = generateSessionHandle();
      const response = json({
        success: true,
        handle,
        binding: signNoteBinding(handle, destKey),
        ...(persist ? { key: destKey } : {}),
      });
      applyHandleSessionCookie(
        response.cookies,
        request.cookies,
        handle,
        destKey,
        persist,
      );
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
              : result.reason === "rate_limited"
                ? "Too many duplicates for this note. Try again later."
                : result.reason === "too_many" || result.reason === "note_full"
                  ? "This note has too many images to duplicate."
                  : "Couldn't duplicate note. Try again.";
      const status =
        result.reason === "not_found"
          ? 404
          : result.reason === "storage_full"
            ? 507
            : result.reason === "too_large" || result.reason === "note_full"
              ? 413
              : result.reason === "too_many"
                ? 409
                : result.reason === "rate_limited"
                  ? 429
                  : 502;
      const headers: Record<string, string> | undefined =
        result.reason === "rate_limited" && result.retryAfter
          ? { "Retry-After": String(result.retryAfter) }
          : undefined;
      return json({ error: message }, status, headers);
    }
  }

  return json({ error: "Couldn't duplicate note. Try again." }, 500);
}
