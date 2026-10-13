/**
 * Embed rules shared by the server (reserve, shell) and the browser (renderer,
 * bridge). docs/embeds.md is the agent-facing description of the same rules.
 */

export const EMBED_SCHEME = "marker-embed:";
export const EMBED_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export const MAX_EMBED_BYTES = 512 * 1024;
export const MAX_NOTE_EMBEDS = 10;

export const SCRIPT_CDN = "https://cdn.jsdelivr.net/npm/";
export const GEIST_VERSION = "1.7.2";
export const GEIST_SANS_URL = `${SCRIPT_CDN}geist@${GEIST_VERSION}/dist/fonts/geist-sans/Geist-Variable.woff2`;
export const GEIST_MONO_URL = `${SCRIPT_CDN}geist@${GEIST_VERSION}/dist/fonts/geist-mono/GeistMono-Variable.woff2`;

export const EMBED_MIN_HEIGHT = 120;
export const EMBED_MAX_HEIGHT = 2000;
export const EMBED_DEFAULT_HEIGHT = 360;
/** On narrow screens an embed is never taller than this many viewports. */
export const EMBED_MOBILE_VIEWPORTS = 1.5;
export const EMBED_HEARTBEAT_MS = 1000;
export const EMBED_STALL_MS = 5000;
export const EMBED_OFFSCREEN_STOP_MS = 30_000;
export const EMBED_MESSAGE_MAX_BYTES = 8 * 1024;
export const EMBED_MESSAGES_PER_SECOND = 50;

/**
 * The policy every agent document runs under. `connect` is only widened for
 * the shell's own single fetch of the raw file; the document it writes adds
 * this policy again with `connect-src 'none'`, and policies only intersect.
 */
export function embedCsp(connect: string | null = null): string {
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline' 'unsafe-eval' ${SCRIPT_CDN}`,
    `style-src 'unsafe-inline' ${SCRIPT_CDN} https://fonts.googleapis.com`,
    `font-src ${SCRIPT_CDN} https://fonts.gstatic.com data:`,
    "img-src data: blob:",
    "media-src data: blob:",
    `connect-src ${connect ?? "'none'"}`,
    "worker-src 'none'",
    "child-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "manifest-src 'none'",
    "prefetch-src 'none'",
  ].join("; ");
}

export type EmbedParams = { h: number | null; ratio: [number, number] | null; poster: string | null };

/** The markdown title slot: `![caption](marker-embed:<id> "h=420 ratio=16:9 poster=marker-asset:<id>")`. */
export function parseEmbedParams(title: string | null | undefined): EmbedParams {
  const out: EmbedParams = { h: null, ratio: null, poster: null };
  for (const part of (title ?? "").trim().split(/\s+/)) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const name = part.slice(0, eq).toLowerCase();
    const value = part.slice(eq + 1).replace(/^["']|["']$/g, "");
    if (name === "h" && /^\d{1,5}$/.test(value)) out.h = clampHeight(Number(value));
    else if (name === "ratio") {
      const match = /^(\d{1,4})[:/x](\d{1,4})$/.exec(value);
      if (match && Number(match[1]) > 0 && Number(match[2]) > 0) out.ratio = [Number(match[1]), Number(match[2])];
    } else if (name === "poster" && value.startsWith("marker-asset:")) {
      const id = value.slice("marker-asset:".length);
      if (EMBED_ID_PATTERN.test(id)) out.poster = id;
    }
  }
  return out;
}

export function clampHeight(height: number, max = EMBED_MAX_HEIGHT): number {
  return Math.round(Math.min(Math.max(height, EMBED_MIN_HEIGHT), Math.max(EMBED_MIN_HEIGHT, Math.min(max, EMBED_MAX_HEIGHT))));
}

export type EmbedMessage =
  | { type: "heartbeat" }
  | { type: "ready" }
  | { type: "resize"; height: number }
  | { type: "openLink"; url: string }
  | { type: "error"; message: string };

const ERROR_MAX = 500;

/** Embed → parent messages, schema-checked. Anything else, or anything over 8 KB, is dropped. */
export function parseEmbedMessage(data: unknown): EmbedMessage | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  let size: number;
  try {
    size = new TextEncoder().encode(JSON.stringify(data)).length;
  } catch {
    return null;
  }
  if (size > EMBED_MESSAGE_MAX_BYTES) return null;
  const message = data as Record<string, unknown>;
  switch (message.type) {
    case "heartbeat":
    case "ready":
      return { type: message.type };
    case "resize":
      return typeof message.height === "number" && Number.isFinite(message.height) ? { type: "resize", height: message.height } : null;
    case "openLink": {
      const url = httpsUrl(message.url);
      return url ? { type: "openLink", url } : null;
    }
    case "error":
      return typeof message.message === "string" ? { type: "error", message: message.message.slice(0, ERROR_MAX) } : null;
    default:
      return null;
  }
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

/** Sliding one-second window. */
export function messageBudget(limit = EMBED_MESSAGES_PER_SECOND, windowMs = 1000) {
  const times: number[] = [];
  return (now: number) => {
    while (times.length && now - times[0] >= windowMs) times.shift();
    if (times.length >= limit) return false;
    times.push(now);
    return true;
  };
}

/** When a SigV4 presigned URL stops working, or null if it isn't one. */
export function presignedExpiry(url: string): number | null {
  try {
    const params = new URL(url).searchParams;
    const date = params.get("X-Amz-Date");
    const expires = Number(params.get("X-Amz-Expires"));
    const match = date && /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(date);
    if (!match || !Number.isFinite(expires)) return null;
    return Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5], +match[6]) + expires * 1000;
  } catch {
    return null;
  }
}

/** Origin allowlist entries may use one leading `*.` label wildcard, e.g. `https://*.vercel.app`. */
export function originAllowed(origin: string, allowed: readonly string[]): boolean {
  return allowed.some(pattern => {
    if (pattern === origin) return true;
    const star = /^(https?:\/\/)\*\.(.+)$/.exec(pattern);
    return Boolean(star && origin.startsWith(star[1]) && origin.endsWith(`.${star[2]}`) && !origin.slice(star[1].length).includes("/"));
  });
}
