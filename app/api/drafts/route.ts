import { NextRequest, NextResponse } from "next/server";
import { normalizeKey } from "@/app/lib/key";
import { requireNoteKey } from "@/app/lib/noteApi";
import { applyNoIndexHeaders } from "@/app/lib/robots";
import { commitResponses, readAccessedNote, readNote } from "@/app/lib/notes";
import { applyResponseChanges, reactionBlocks } from "@/app/lib/responses";

function json(value: unknown, status = 200) {
  const response = NextResponse.json(value, { status });
  applyNoIndexHeaders(response.headers);
  response.headers.set("Cache-Control", "no-store, private");
  return response;
}
export async function GET(request: NextRequest) {
  const resolved = requireNoteKey(request, request.nextUrl.searchParams.get("key"));
  if (!resolved.ok) return json(resolved.body, resolved.status);
  const { key } = resolved;
  const note = await readAccessedNote(key, true);
  if (!note) return json({ error: "Note not found" }, 404);
  const blocks = reactionBlocks(note.content);
  const active = new Set(blocks.map(block => block.id));
  return json({
    rev: note.rev,
    blocks,
    responses: note.responses.map(entry => ({ ...entry, active: active.has(entry.block_id) })),
  });
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 64 * 1024) return json({ error: "Request too large" }, 413);
    body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  if ("submit" in body) return json({ error: "Choices are drafts; respond in chat" }, 400);
  const resolved = requireNoteKey(request, body.key);
  if (!resolved.ok) return json(resolved.body, resolved.status);
  const { key } = resolved;
  if (!Number.isSafeInteger(body.if_rev) || (body.if_rev as number) < 0) return json({ error: "if_rev is required" }, 400);
  const before = await readNote(key, true);
  if (!before) return json({ error: "Note not found" }, 404);
  if (before.rev !== body.if_rev) return json({ error: "Note or responses changed; reload and review before retrying", rev: before.rev }, 409);
  let responses;
  try {
    responses = applyResponseChanges(reactionBlocks(before.content), before.responses, body.changes);
  } catch (error) {
    return json({ error: (error as Error).message }, 400);
  }
  const result = await commitResponses(key, before, responses, normalizeKey(body.key) ? "agent" : "human");
  if (result.status !== "ok") return json({
    error: result.status === "missing" ? "Note not found" : "Note or responses changed; reload and review before retrying",
  }, result.status === "missing" ? 404 : 409);
  return json({ rev: result.rev, responses });
}
