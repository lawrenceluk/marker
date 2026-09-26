import { NextRequest, NextResponse } from "next/server";
import { normalizeKey, SESSION_COOKIE } from "@/app/lib/key";
import { applyNoIndexHeaders } from "@/app/lib/robots";
import { readNote, commitComments, MAX_CONTENT_BYTES } from "@/app/lib/notes";
import { applyComments, locateThreads } from "@/app/lib/comments";

function json(value: unknown, status = 200) {
  const response = NextResponse.json(value, { status });
  applyNoIndexHeaders(response.headers);
  response.headers.set("Cache-Control", "no-store, private");
  return response;
}
function keyFor(request: NextRequest, explicit: unknown) {
  return (
    normalizeKey(explicit) ??
    normalizeKey(request.cookies.get(SESSION_COOKIE)?.value)
  );
}
export async function GET(request: NextRequest) {
  const key = keyFor(request, request.nextUrl.searchParams.get("key"));
  if (!key) return json({ error: "Key is required" }, 400);
  const note = await readNote(key, true);
  if (!note) return json({ error: "Note not found" }, 404);
  const status = request.nextUrl.searchParams.get("status") ?? "open";
  if (!["open", "resolved", "all"].includes(status))
    return json({ error: "Invalid status" }, 400);
  return json({
    rev: note.rev,
    content: note.content,
    comments: locateThreads(note.content, note.comments).filter(
      (t) => status === "all" || t.resolved === (status === "resolved"),
    ),
  });
}
export async function POST(request: NextRequest) {
  let body;
  try {
    // Bound parse work, including chunked requests without Content-Length.
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 2 * MAX_CONTENT_BYTES)
      return json({ error: "Request too large" }, 413);
    body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new Error();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const key = keyFor(request, body.key);
  if (!key) return json({ error: "Key is required" }, 400);
  if (!Number.isSafeInteger(body.if_rev) || body.if_rev < 0)
    return json({ error: "if_rev is required" }, 400);
  if (body.content !== undefined && typeof body.content !== "string")
    return json({ error: "Content must be a string" }, 400);
  if (
    typeof body.content === "string" &&
    Buffer.byteLength(body.content) > MAX_CONTENT_BYTES
  )
    return json({ error: "Content exceeds 1 MiB" }, 413);
  const before = await readNote(key, true);
  if (!before) return json({ error: "Note not found" }, 404);
  if (before.rev !== body.if_rev)
    return json(
      {
        error: "Note or comments changed; reload and review before retrying",
        rev: before.rev,
      },
      409,
    );
  let comments;
  try {
    // Browser uses its cookie; explicit bearer-key callers are labeled Agent.
    // These are presentation roles, not authenticated identities.
    comments = applyComments(
      before.content,
      before.comments,
      body.operations,
      before.rev,
      normalizeKey(body.key) ? "Agent" : "You",
    );
  } catch (error) {
    return json({ error: (error as Error).message }, 400);
  }
  const content = body.content ?? before.content;
  const result = await commitComments(key, before, content, comments);
  if (result.status !== "ok")
    return json(
      {
        error:
          result.status === "missing"
            ? "Note not found"
            : "Note or comments changed; reload and review before retrying",
      },
      result.status === "missing" ? 404 : 409,
    );
  return json({
    rev: before.rev + 1,
    content,
    comments: locateThreads(content, result.comments),
  });
}
