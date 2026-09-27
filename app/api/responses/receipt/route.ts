import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { normalizeKey } from "@/app/lib/key";
import { readNote } from "@/app/lib/notes";
import { reactionBlocks } from "@/app/lib/responses";
import { applyNoIndexHeaders } from "@/app/lib/robots";

function json(value: unknown, status = 200) {
  const response = NextResponse.json(value, { status });
  applyNoIndexHeaders(response.headers);
  response.headers.set("Cache-Control", "no-store, private");
  return response;
}

/** Bounded polling receipt: no answer data, and no access-time write. */
export async function POST(request: NextRequest) {
  let key: string | null;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 1024) return json({ error: "Request too large" }, 413);
    const body = JSON.parse(raw);
    key = normalizeKey(body?.key);
  } catch { return json({ error: "Invalid JSON body" }, 400); }
  if (!key) return json({ error: "Key is required" }, 400);
  const note = await readNote(key, true);
  if (!note) return json({ error: "Note not found" }, 404);
  const asks = new Set(reactionBlocks(note.content).filter(block => block.kind === "ask").map(block => block.id));
  const submitted = note.responses.filter(entry => asks.has(entry.block_id)).reduce<number | null>((latest, entry) =>
    entry.submitted_at === null ? latest : Math.max(latest ?? 0, entry.submitted_at), null);
  return json({ note_id: createHash("sha256").update(key).digest("hex").slice(0, 24), ask_submitted_at: submitted });
}
