import type { NextRequest } from "next/server";
import { normalizeKey } from "@/app/lib/key";
import {
  resolveNoteKey,
  noteSwitchedBody,
  noteSessionExpiredBody,
} from "@/app/lib/noteSession";

export type NoteRouteResult =
  | { ok: true; key: string; handle: string | null; browser: boolean }
  | { ok: false; status: number; body: Record<string, unknown> };

export function requireNoteKey(
  request: NextRequest,
  explicit: unknown
): NoteRouteResult {
  const key =
    normalizeKey(explicit) ||
    normalizeKey(request.nextUrl.searchParams.get("key"));
  const resolved = resolveNoteKey(request, key || undefined);
  if (!resolved.ok) {
    const body =
      resolved.code === "note_switched"
        ? noteSwitchedBody()
        : resolved.code === "note_session_expired"
          ? noteSessionExpiredBody()
          : { error: resolved.error };
    return { ok: false, status: resolved.status, body };
  }
  return {
    ok: true,
    key: resolved.key,
    handle: resolved.handle,
    browser: resolved.browser,
  };
}
