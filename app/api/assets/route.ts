import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, normalizeKey } from "@/app/lib/key";
import { applyNoIndexHeaders } from "@/app/lib/robots";
import { r2Config, putObject } from "@/app/lib/r2";
import {
  ASSET_TYPE_LIST,
  UPLOAD_URL_TTL_SECONDS,
  assetMarkdown,
  assetTypeFor,
  assetUrls,
  contentTypeOf,
  objectKey,
  reserveAsset,
  storedContentType,
  uploadUrl,
} from "@/app/lib/assets";
import { MAX_EMBED_BYTES, MAX_NOTE_EMBEDS } from "@/app/lib/embedPolicy";
import { embedHtmlProblem, ensureEmbedShell } from "@/app/lib/embeds";
import { MAX_ASSET_BYTES, MAX_BASE64_BYTES, MAX_NOTE_ASSETS, MAX_NOTE_ASSET_BYTES } from "@/app/lib/assetIndex";
import { deliverStorageAlert, runAfter } from "@/app/lib/assetJobs";

function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  const response = NextResponse.json(data, { status, headers });
  applyNoIndexHeaders(response.headers);
  response.headers.set("Cache-Control", "no-store, private");
  return response;
}

const NOT_CONFIGURED = "Image uploads are not configured on this deployment";
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Reserve an image or an HTML embed for a note: returns a presigned PUT
 * straight to R2 and the markdown to insert. With `data_base64` (≤ 1 MiB for
 * images, ≤ 512 KiB for embeds) the server uploads the bytes itself.
 * Reserving never changes the note's rev.
 */
export async function POST(request: NextRequest) {
  const config = r2Config();
  if (!config) return json({ error: NOT_CONFIGURED }, 503);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const key = normalizeKey(body.key) ?? normalizeKey(request.cookies.get(SESSION_COOKIE)?.value);
  if (!key) return json({ error: "Key is required" }, 400);

  const type = assetTypeFor(body.content_type);
  if (!type) return json({ error: `content_type must be one of: ${ASSET_TYPE_LIST.join(", ")}` }, 415);
  const embed = type === "html";
  const maxBase64 = embed ? MAX_EMBED_BYTES : MAX_BASE64_BYTES;
  const maxBytes = embed ? MAX_EMBED_BYTES : MAX_ASSET_BYTES;

  let bytes: Buffer | null = null;
  let size: number;
  if (body.data_base64 !== undefined) {
    if (typeof body.data_base64 !== "string") return json({ error: "data_base64 must be a string" }, 400);
    const encoded = body.data_base64.replace(/\s+/g, "");
    if (encoded.length > Math.ceil(maxBase64 / 3) * 4) {
      return json({ error: embed ? `Embeds are limited to ${MAX_EMBED_BYTES} bytes` : `data_base64 is limited to ${MAX_BASE64_BYTES} decoded bytes; use the presigned upload for larger images` }, 413);
    }
    if (!BASE64.test(encoded)) return json({ error: "data_base64 is not valid base64" }, 400);
    bytes = Buffer.from(encoded, "base64");
    size = bytes.length;
    if (size === 0) return json({ error: "data_base64 is empty" }, 400);
    if (size > maxBase64) return json({ error: `data_base64 is limited to ${maxBase64} decoded bytes` }, 413);
    if (body.size !== undefined && Number(body.size) !== size) return json({ error: "size does not match data_base64" }, 400);
    const problem = embed ? embedHtmlProblem(bytes) : null;
    if (problem) return json({ error: problem }, 400);
  } else {
    size = Number(body.size);
    if (!Number.isInteger(size) || size <= 0) return json({ error: "size must be a positive integer (bytes)" }, 400);
    if (size > maxBytes) return json({ error: `${embed ? "Embeds" : "Images"} are limited to ${maxBytes} bytes` }, 413);
  }

  const result = await reserveAsset(key, type, size);
  if (!result.ok) {
    switch (result.reason) {
      case "not_found":
        return json({ error: "Note not found. Write the note before adding images." }, 404);
      case "too_many":
        return json({ error: `A note can hold at most ${MAX_NOTE_ASSETS} images and embeds` }, 409);
      case "too_many_embeds":
        return json({ error: `A note can hold at most ${MAX_NOTE_EMBEDS} embeds` }, 409);
      case "note_full":
        return json({ error: `A note's images and embeds are limited to ${MAX_NOTE_ASSET_BYTES} bytes in total` }, 413);
      case "rate_limited":
        return json({ error: "Too many image uploads for this note. Try again later." }, 429, { "Retry-After": String(result.retryAfter) });
      case "storage_full":
        if (result.alert) runAfter(() => deliverStorageAlert("stop", result.totalBytes));
        return json({ error: "Image storage is full. Uploads are paused." }, 507);
    }
  }
  if (result.warn) runAfter(() => deliverStorageAlert("warn", result.totalBytes));
  if (embed) runAfter(() => ensureEmbedShell(config));

  const view = assetUrls(config, { assetNs: result.ns, assets: { [result.id]: { t: type, s: size, c: Date.now() } } })[result.id];
  const common = {
    asset_id: result.id,
    markdown: assetMarkdown(type, result.id),
    type: contentTypeOf(type),
    size,
    url: view.url,
    url_expires_at: view.expires_at,
  };

  if (bytes) {
    try {
      await putObject(config, objectKey(result.ns, result.id), bytes, storedContentType(type));
    } catch (error) {
      console.error("[marker] base64 asset upload failed:", error);
      return json({ error: "Upload to storage failed. Try again." }, 502);
    }
    return json({ ...common, uploaded: true });
  }

  const upload = uploadUrl(config, result.ns, result.id, type, size);
  return json({ ...common, uploaded: false, upload_url: upload.url, upload_headers: upload.headers, expires_in: UPLOAD_URL_TTL_SECONDS });
}
