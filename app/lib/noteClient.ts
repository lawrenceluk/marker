"use client";

export const NOTE_BINDING_HEADER = "X-Marker-Note";
export const NOTE_SWITCHED_CODE = "note_switched";
export const NOTE_SESSION_EXPIRED_CODE = "note_session_expired";

export type NoteBinding = string;

export function noteApiHeaders(
  binding: NoteBinding | null,
  extra?: HeadersInit
): HeadersInit {
  const headers = new Headers(extra);
  if (binding) headers.set(NOTE_BINDING_HEADER, binding);
  return headers;
}

export function withPersistKeyUrl(
  input: string,
  persistKey: string | null | undefined
): string {
  if (!persistKey) return input;
  if (!input.startsWith("/api/")) return input;
  const url = new URL(input, "http://marker.local");
  if (!url.searchParams.has("key")) {
    url.searchParams.set("key", persistKey);
  }
  return `${url.pathname}${url.search}`;
}

export async function readJsonSafe(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function isNoteSwitchedResponse(
  status: number,
  data: Record<string, unknown>
): boolean {
  return status === 409 && data.code === NOTE_SWITCHED_CODE;
}

export function isNoteExpiredResponse(
  status: number,
  data: Record<string, unknown>
): boolean {
  return status === 409 && data.code === NOTE_SESSION_EXPIRED_CODE;
}

export function apiErrorMessage(
  data: Record<string, unknown>,
  fallback: string
): string {
  return typeof data.error === "string" ? data.error : fallback;
}
