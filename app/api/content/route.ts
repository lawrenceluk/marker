import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, normalizeKey } from "@/app/lib/key";
import {
  MAX_CONTENT_BYTES,
  MAX_TTL_SECONDS,
  WRITE_MODES,
  WriteMode,
  readNote,
  writeNote,
} from "@/app/lib/notes";

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
    return NextResponse.json({ error: "Key is required" }, { status: 400 });
  }

  const note = await readNote(key);

  // Same shape either way, so callers never have to branch on `exists` before
  // reading a field. A note that doesn't exist reads as rev 0, which is also
  // the value `if_rev` wants for create-only-if-absent.
  if (!note) {
    return NextResponse.json({
      content: null,
      exists: false,
      rev: 0,
      updated_at: null,
      created_at: null,
      expires_at: null,
      size: 0,
    });
  }

  return NextResponse.json({
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
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const key = resolveKey(request, body.key);
  if (!key) {
    return NextResponse.json({ error: "Key is required" }, { status: 400 });
  }

  const { content } = body;
  if (typeof content !== "string") {
    return NextResponse.json({ error: "Content must be a string" }, { status: 400 });
  }

  // Cheap rejection before the round trip; the write script enforces the same
  // limit on the resulting document, which is what actually matters for append.
  if (Buffer.byteLength(content, "utf8") > MAX_CONTENT_BYTES) {
    return NextResponse.json(
      { error: `Content exceeds the ${MAX_CONTENT_BYTES} byte limit` },
      { status: 413 }
    );
  }

  const mode = (body.mode ?? "overwrite") as WriteMode;
  if (!WRITE_MODES.includes(mode)) {
    return NextResponse.json(
      { error: `Mode must be one of: ${WRITE_MODES.join(", ")}` },
      { status: 400 }
    );
  }

  let ifRev: number | undefined;
  if (body.if_rev !== undefined && body.if_rev !== null) {
    ifRev = Number(body.if_rev);
    if (!Number.isInteger(ifRev) || ifRev < 0) {
      return NextResponse.json(
        { error: "if_rev must be a non-negative integer" },
        { status: 400 }
      );
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
        return NextResponse.json(
          { error: `ttl must be an integer between 0 and ${MAX_TTL_SECONDS} seconds` },
          { status: 400 }
        );
      }
    }
  }

  const result = await writeNote(key, content, { mode, ifRev, ttl });

  if (!result.ok) {
    if (result.reason === "too_large") {
      return NextResponse.json(
        {
          error: `Resulting note is ${result.size} bytes, over the ${MAX_CONTENT_BYTES} byte limit`,
        },
        { status: 413 }
      );
    }

    // Hand back the current state so a caller can merge without a second GET.
    return NextResponse.json(
      {
        error: "Note has changed since if_rev",
        rev: result.rev,
        content: result.content,
      },
      { status: 409 }
    );
  }

  return NextResponse.json({
    success: true,
    rev: result.rev,
    updated_at: result.updatedAt,
    expires_at: result.expiresAt,
    size: result.size,
  });
}
