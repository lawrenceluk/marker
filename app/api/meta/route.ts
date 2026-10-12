import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, normalizeKey } from "@/app/lib/key";
import { updateNoteMeta } from "@/app/lib/notes";
import { applyNoIndexHeaders } from "@/app/lib/robots";
import { CREATOR_FORBIDDEN, CREATOR_REQUIRED, parseCreatorParams } from "@/app/lib/creators";

function json(data: unknown, status = 200) {
  const response = NextResponse.json(data, { status });
  applyNoIndexHeaders(response.headers);
  return response;
}

/**
 * Change a note's creator, folder name or tags. Content, rev and updated_at
 * are untouched, so this never conflicts with content writers. One EVAL.
 */
export async function PATCH(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const key = normalizeKey(body.key) ?? normalizeKey(request.cookies.get(SESSION_COOKIE)?.value);
  if (!key) return json({ error: "Key is required" }, 400);

  const params = parseCreatorParams(body, request);
  if (!params.ok) return json({ error: params.error }, 400);
  if (!params.touchesCreator) {
    return json({ error: "Nothing to change: pass creator_id, creator_name or tags" }, 400);
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
  });
}
