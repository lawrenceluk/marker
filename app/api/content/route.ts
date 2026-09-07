import { NextRequest, NextResponse } from "next/server";
import {
  PERSIST_COOKIE,
  SESSION_COOKIE,
  applySessionCookies,
  normalizeKey,
} from "@/app/lib/key";
import {
  MAX_CONTENT_BYTES,
  MAX_TTL_SECONDS,
  WRITE_MODES,
  WriteMode,
  readNote,
  renameNote,
  writeNote,
} from "@/app/lib/notes";
import { applyNoIndexHeaders } from "@/app/lib/robots";

function json(data: unknown, status = 200) {
  const response = NextResponse.json(data, { status });
  applyNoIndexHeaders(response.headers);
  return response;
}

/**
 * An explicit key wins — that's how agents call this. The browser sends none
 * and falls back to the session cookie, so the key never has to be handed to
 * client-side JS. SameSite=lax keeps the cookie off cross-site POSTs, so the
 * fallback isn't a CSRF write path.
 */
function resolveKey(request: NextRequest, explicit: unknown): string | null {
  return (
    normalizeKey(explicit) ??
    normalizeKey(request.cookies.get(SESSION_COOKIE)?.value)
  );
}

export async function GET(request: NextRequest) {
  const key = resolveKey(request, request.nextUrl.searchParams.get("key"));

  if (!key) {
    return json({ error: "Key is required" }, 400);
  }

  const note = await readNote(key);

  // Same shape either way, so callers never have to branch on `exists` before
  // reading a field. A note that doesn't exist reads as rev 0, which is also
  // the value `if_rev` wants for create-only-if-absent.
  if (!note) {
    return json({
      content: null,
      exists: false,
      rev: 0,
      updated_at: null,
      created_at: null,
      expires_at: null,
      size: 0,
    });
  }

  return json({
    content: note.content,
    exists: true,
    rev: note.rev,
    updated_at: note.updatedAt,
    created_at: note.createdAt,
    expires_at: note.expiresAt,
    size: Buffer.byteLength(note.content, "utf8"),
  });
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const key = resolveKey(request, body.key);
  if (!key) {
    return json({ error: "Key is required" }, 400);
  }

  const { content } = body;
  if (typeof content !== "string") {
    return json({ error: "Content must be a string" }, 400);
  }

  // Cheap rejection before the round trip; the write script enforces the same
  // limit on the resulting document, which is what actually matters for append.
  if (Buffer.byteLength(content, "utf8") > MAX_CONTENT_BYTES) {
    return json(
      { error: `Content exceeds the ${MAX_CONTENT_BYTES} byte limit` },
      413
    );
  }

  const mode = (body.mode ?? "overwrite") as WriteMode;
  if (!WRITE_MODES.includes(mode)) {
    return json(
      { error: `Mode must be one of: ${WRITE_MODES.join(", ")}` },
      400
    );
  }

  let ifRev: number | undefined;
  if (body.if_rev !== undefined && body.if_rev !== null) {
    ifRev = Number(body.if_rev);
    if (!Number.isInteger(ifRev) || ifRev < 0) {
      return json({ error: "if_rev must be a non-negative integer" }, 400);
    }
  }

  // Omitted leaves any existing expiry alone; null or 0 clears it.
  let ttl: number | null | undefined;
  if (body.ttl !== undefined) {
    if (body.ttl === null) {
      ttl = null;
    } else {
      ttl = Number(body.ttl);
      if (!Number.isInteger(ttl) || ttl < 0 || ttl > MAX_TTL_SECONDS) {
        return json(
          { error: `ttl must be an integer between 0 and ${MAX_TTL_SECONDS} seconds` },
          400
        );
      }
    }
  }

  const result = await writeNote(key, content, { mode, ifRev, ttl });

  if (!result.ok) {
    if (result.reason === "too_large") {
      return json(
        {
          error: `Resulting note is ${result.size} bytes, over the ${MAX_CONTENT_BYTES} byte limit`,
        },
        413
      );
    }

    // Hand back the current state so a caller can merge without a second GET.
    return json(
      {
        error: "Note has changed since if_rev",
        rev: result.rev,
        content: result.content,
      },
      409
    );
  }

  return json({
    success: true,
    rev: result.rev,
    updated_at: result.updatedAt,
    expires_at: result.expiresAt,
    size: result.size,
  });
}

/**
 * Rename the current note's key. Content, rev, and expiry move with it.
 * The destination must be free — we never overwrite another note.
 */
export async function PATCH(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const explicitKey = normalizeKey(body.key);
  const currentKey = resolveKey(request, body.key);
  const newKey = normalizeKey(body.new_key);

  if (!currentKey) {
    return json({ error: "Key is required" }, 400);
  }
  if (!newKey) {
    return json({ error: "new_key is required" }, 400);
  }

  if (currentKey === newKey) {
    return json({ success: true, key: currentKey, renamed: false });
  }

  const result = await renameNote(currentKey, newKey);

  if (!result.ok && result.reason === "exists") {
    return json({ error: "That key already exists" }, 409);
  }

  if (!result.ok && result.reason === "not_found") {
    // Cookie session on an unsaved note: just adopt the new key. An explicit
    // key from an agent that doesn't exist is a 404.
    if (explicitKey) {
      return json({ error: "Note not found" }, 404);
    }
  } else if (!result.ok) {
    return json({ error: "Failed to rename key" }, 500);
  }

  const persist = request.cookies.get(PERSIST_COOKIE)?.value === "1";
  const response = json({ success: true, key: newKey, renamed: true });
  applySessionCookies(response.cookies, newKey, persist);
  return response;
}
