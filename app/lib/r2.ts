import { createHash, createHmac } from "node:crypto";

/**
 * Minimal S3 SigV4 client for one private Cloudflare R2 bucket. Presigning
 * is a local HMAC; only server-side put/delete/list make network calls.
 */
export type R2Config = {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
};

export function r2Config(env: Record<string, string | undefined> = process.env): R2Config | null {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_ENDPOINT } = env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) return null;
  return {
    endpoint: (R2_ENDPOINT || `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`).replace(/\/+$/, ""),
    bucket: R2_BUCKET,
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
    region: "auto",
  };
}

const ALGORITHM = "AWS4-HMAC-SHA256";
export const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";

const sha256Hex = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data).digest();

/** RFC 3986 encoding, as SigV4 requires. */
export function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

const encodePath = (path: string) => path.split("/").map(segment => uriEncode(decodeURIComponent(segment))).join("/");

export function amzDate(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function canonicalQuery(params: URLSearchParams): string {
  return [...params.entries()]
    .map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
    .sort(([a, av], [b, bv]) => (a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}

export type SigningInput = {
  method: string;
  url: URL;
  /** Lowercase header names to their values; must include `host`. */
  headers: Record<string, string>;
  payloadHash: string;
  date: string;
  config: Pick<R2Config, "accessKeyId" | "secretAccessKey" | "region">;
  service?: string;
};

/** SigV4 signature over the canonical request. Query params already on `url` are signed as-is. */
export function signature(input: SigningInput): { signature: string; signedHeaders: string; scope: string } {
  const { method, url, headers, payloadHash, date, config, service = "s3" } = input;
  const names = Object.keys(headers).map(h => h.toLowerCase()).sort();
  const signedHeaders = names.join(";");
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const canonicalHeaders = names.map(name => `${name}:${String(lower[name]).trim().replace(/\s+/g, " ")}\n`).join("");
  const query = new URLSearchParams(url.search);
  query.delete("X-Amz-Signature");
  const canonical = [method, encodePath(url.pathname), canonicalQuery(query), canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const day = date.slice(0, 8);
  const scope = `${day}/${config.region}/${service}/aws4_request`;
  const toSign = [ALGORITHM, date, scope, sha256Hex(canonical)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${config.secretAccessKey}`, day), config.region), service), "aws4_request");
  return { signature: createHmac("sha256", key).update(toSign).digest("hex"), signedHeaders, scope };
}

/** A query-string presigned URL. `headers` (besides host) must be sent verbatim by the client. */
export function presign(
  config: R2Config,
  method: "GET" | "PUT",
  objectKey: string,
  options: { now: number; expiresIn: number; headers?: Record<string, string>; query?: Record<string, string> },
): string {
  const url = objectUrl(config, objectKey);
  const date = amzDate(options.now);
  const headers = { host: url.host, ...(options.headers ?? {}) };
  for (const [k, v] of Object.entries(options.query ?? {})) url.searchParams.set(k, v);
  url.searchParams.set("X-Amz-Algorithm", ALGORITHM);
  url.searchParams.set("X-Amz-Credential", `${config.accessKeyId}/${date.slice(0, 8)}/${config.region}/s3/aws4_request`);
  url.searchParams.set("X-Amz-Date", date);
  url.searchParams.set("X-Amz-Expires", String(options.expiresIn));
  url.searchParams.set("X-Amz-SignedHeaders", Object.keys(headers).map(h => h.toLowerCase()).sort().join(";"));
  const { signature: sig } = signature({ method, url, headers, payloadHash: UNSIGNED_PAYLOAD, date, config });
  url.search = `${canonicalQuery(url.searchParams)}&X-Amz-Signature=${sig}`;
  return url.toString();
}

const HOUR_MS = 60 * 60 * 1000;

export type AssetUrl = { url: string; expires_at: number };

/**
 * Hour-aligned GET URLs: signed at the top of the hour for two hours, so a
 * URL is byte-identical (and browser-cacheable) for the whole hour and stays
 * valid at least an hour after it is minted.
 */
export function viewUrl(config: R2Config, objectKey: string, contentType: string, now = Date.now()): AssetUrl {
  const signedAt = Math.floor(now / HOUR_MS) * HOUR_MS;
  return {
    url: presign(config, "GET", objectKey, {
      now: signedAt,
      expiresIn: 2 * 3600,
      query: {
        "response-content-type": contentType,
        "response-content-disposition": "inline",
        "response-cache-control": "private, max-age=3600",
      },
    }),
    expires_at: signedAt + 2 * HOUR_MS,
  };
}

export function objectUrl(config: R2Config, objectKey: string): URL {
  return new URL(`${config.endpoint}/${config.bucket}/${objectKey.split("/").map(uriEncode).join("/")}`);
}

async function signedFetch(
  config: R2Config,
  method: string,
  url: URL,
  body?: Uint8Array,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const date = amzDate(Date.now());
  const payloadHash = sha256Hex(body ?? "");
  const headers: Record<string, string> = { host: url.host, "x-amz-date": date, "x-amz-content-sha256": payloadHash, ...extraHeaders };
  const { signature: sig, signedHeaders, scope } = signature({ method, url, headers, payloadHash, date, config });
  const { host: _host, ...sent } = headers;
  void _host;
  return fetch(url, {
    method,
    body: body ? Buffer.from(body) : undefined,
    headers: { ...sent, authorization: `${ALGORITHM} Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${sig}` },
    cache: "no-store",
  });
}

export async function putObject(config: R2Config, objectKey: string, body: Uint8Array, contentType: string): Promise<void> {
  const res = await signedFetch(config, "PUT", objectUrl(config, objectKey), body, { "content-type": contentType });
  if (!res.ok) throw new Error(`R2 PUT failed: ${res.status}`);
}

export async function objectExists(config: R2Config, objectKey: string): Promise<boolean> {
  const res = await signedFetch(config, "HEAD", objectUrl(config, objectKey));
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`R2 HEAD failed: ${res.status}`);
  return true;
}

/** DeleteObject is idempotent: a missing object is still a 204. */
export async function deleteObject(config: R2Config, objectKey: string): Promise<void> {
  const res = await signedFetch(config, "DELETE", objectUrl(config, objectKey));
  if (!res.ok && res.status !== 404) throw new Error(`R2 DELETE failed: ${res.status}`);
}

const xmlText = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** Every object key under `prefix` (ListObjectsV2, 1,000 per page). */
export async function listObjects(config: R2Config, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | null = null;
  do {
    const url = new URL(`${config.endpoint}/${config.bucket}`);
    url.searchParams.set("list-type", "2");
    url.searchParams.set("prefix", prefix);
    if (token) url.searchParams.set("continuation-token", token);
    const res = await signedFetch(config, "GET", url);
    if (!res.ok) throw new Error(`R2 LIST failed: ${res.status}`);
    const xml = await res.text();
    for (const match of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) keys.push(xmlText(match[1]));
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? xmlText(/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml)?.[1] ?? "") || null : null;
  } while (token);
  return keys;
}
