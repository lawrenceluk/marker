import type { NextRequest } from "next/server";
import { resolveNoteKey, noteSwitchedBody } from "@/app/lib/noteSession";

export type NoteRouteResult =
  | { ok: true; key: string; handle: string | null; browser: boolean }
  | { ok: false; status: number; body: Record<string, unknown> };

export function requireNoteKey(
  request: NextRequest,
  explicit: unknown
): NoteRouteResult {
  const resolved = resolveNoteKey(request, explicit);
  if (!resolved.ok) {
    return {
      ok: false,
      status: resolved.status,
      body:
        resolved.code === "note_switched"
          ? noteSwitchedBody()
          : { error: resolved.error },
    };
  }
  return {
    ok: true,
    key: resolved.key,
    handle: resolved.handle,
    browser: resolved.browser,
  };
}

export function parseBindingHandle(
  request: NextRequest
): string | null {
  const resolved = resolveNoteKey(request, null);
  return resolved.ok ? resolved.handle : null;
}
