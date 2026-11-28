import { NextRequest, NextResponse } from "next/server";
import { requireNoteKey } from "@/app/lib/noteApi";
import { applyNoIndexHeaders } from "@/app/lib/robots";
import { commitInk, readAccessedNote, readInk, readNote } from "@/app/lib/notes";
import { applyInk, exportMarkdown, exportStrokes, locateStrokes, parseInk } from "@/app/lib/ink";

function headers(response: NextResponse) {
  applyNoIndexHeaders(response.headers);
  response.headers.set("Cache-Control", "no-store, private");
  return response;
}
const json = (value: unknown, status = 200) => headers(NextResponse.json(value, { status }));

/**
 * Ink annotations. `GET` returns `{rev, ink_rev, annotations, strokes}`: `annotations` is the
 * agent-readable export (kind, quoted text, block), `strokes` adds geometry for the reader.
 * `?format=markdown` returns only a Markdown list of the annotations.
 */
export async function GET(request: NextRequest) {
  const resolved = requireNoteKey(request, request.nextUrl.searchParams.get("key"));
  if (!resolved.ok) return json(resolved.body, resolved.status);
  const note = await readAccessedNote(resolved.key);
  if (!note) return json({ error: "Note not found" }, 404);
  const ink = await readInk(resolved.key);
  const strokes = locateStrokes(note.content, parseInk(ink?.raw));
  const annotations = exportStrokes(note.content, strokes);
  if (request.nextUrl.searchParams.get("format") === "markdown")
    return headers(new NextResponse(exportMarkdown(annotations), { headers: { "Content-Type": "text/markdown; charset=utf-8" } }));
  return json({ rev: note.rev, ink_rev: ink?.inkRev ?? 0, annotations, strokes });
}

/** `{key?, if_ink_rev, operations:[{action:"add",stroke}|{action:"remove",id}|{action:"clear"}]}`. */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 256 * 1024) return json({ error: "Request too large" }, 413);
    body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const resolved = requireNoteKey(request, body.key);
  if (!resolved.ok) return json(resolved.body, resolved.status);
  if (!Number.isSafeInteger(body.if_ink_rev) || (body.if_ink_rev as number) < 0) return json({ error: "if_ink_rev is required" }, 400);
  const note = await readNote(resolved.key);
  const ink = note && await readInk(resolved.key);
  if (!note || !ink) return json({ error: "Note not found" }, 404);
  if (ink.inkRev !== body.if_ink_rev) return json({ error: "Ink changed; reload before drawing again", ink_rev: ink.inkRev }, 409);
  let next;
  try {
    next = applyInk(note.content, parseInk(ink.raw), body.operations);
  } catch (error) {
    return json({ error: (error as Error).message }, 400);
  }
  const result = await commitInk(resolved.key, ink.inkRev, JSON.stringify({ strokes: next }));
  if (result.status === "missing") return json({ error: "Note not found" }, 404);
  if (result.status === "conflict") return json({ error: "Ink changed; reload before drawing again", ink_rev: result.inkRev }, 409);
  const strokes = locateStrokes(note.content, next);
  return json({ ink_rev: result.inkRev, annotations: exportStrokes(note.content, strokes), strokes });
}
