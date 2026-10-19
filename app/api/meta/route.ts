import { NextRequest, NextResponse } from "next/server";
import { requireNoteKey } from "@/app/lib/noteApi";
import { markSeen, updateNoteMeta } from "@/app/lib/notes";
import { applyNoIndexHeaders } from "@/app/lib/robots";
import { CREATOR_FORBIDDEN, CREATOR_REQUIRED, parseCreatorParams } from "@/app/lib/creators";

function json(data: unknown, status = 200) {
  const response = NextResponse.json(data, { status });
  applyNoIndexHeaders(response.headers);
  return response;
}

/**
 * Change a note's creator, folder name or tags, or mark it seen ("seen": true: a person has
 * looked at it as it is now). Content, rev and updated_at are untouched, so this never
 * conflicts with content writers.
 */
export async function PATCH(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const resolved = requireNoteKey(request, body.key);
  if (!resolved.ok) return json(resolved.body, resolved.status);
  const { key } = resolved;

  if ("seen" in body && body.seen !== true) return json({ error: "seen must be true" }, 400);
  if ("rev" in body && (!Number.isInteger(body.rev) || (body.rev as number) < 0)) return json({ error: "rev must be a non-negative integer" }, 400);
  const params = parseCreatorParams(body, request);
  if (!params.ok) return json({ error: params.error }, 400);
  if (!params.touchesCreator && body.seen !== true) {
    return json({ error: "Nothing to change: pass creator_id, creator_name, tags or seen" }, 400);
  }

  let seen: { rev: number; seenAt: number } | null = null;
  if (body.seen === true) {
    seen = await markSeen(key, { rev: typeof body.rev === "number" ? body.rev : undefined });
    if (!seen) return json({ error: "Note not found" }, 404);
    if (!params.touchesCreator) return json({ success: true, seen_rev: seen.rev, seen_at: seen.seenAt });
  }

  const result = await updateNoteMeta(key, params.change);
  if (!result.ok) {
    if (result.reason === "not_found") return json({ error: "Note not found" }, 404);
    if (result.reason === "forbidden") return json({ error: CREATOR_FORBIDDEN }, 403);
    return json({ error: CREATOR_REQUIRED }, 400);
  }

  return json({
    success: true,
    ...(params.generatedId ? { creator_id: params.generatedId } : {}),
    has_creator: result.hasCreator,
    creator_name: result.creatorName,
    tags: result.tags,
    ...(seen ? { seen_rev: seen.rev, seen_at: seen.seenAt } : {}),
  });
}
