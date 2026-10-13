import { embedShellHtml } from "./embedShell";
import { objectExists, putObject, viewUrl, type AssetUrl, type R2Config } from "./r2";

/** One immutable copy per bucket, outside every `<asset_ns>/` prefix, so the sweep never touches it. */
export const EMBED_SHELL_KEY = "embed-shell-v1.html";
export const EMBED_SHELL_TYPE = "text/html; charset=utf-8";

const DEFAULT_PARENT_ORIGINS = ["https://marker.luk.xyz", "https://*.vercel.app"];

/** Pages the shell agrees to run inside (best effort: browsers may hide ancestor origins). */
export function embedParentOrigins(env: Record<string, string | undefined> = process.env): string[] {
  const listed = (env.EMBED_PARENT_ORIGINS ?? "").split(",").map(s => s.trim()).filter(Boolean);
  return listed.length ? listed : DEFAULT_PARENT_ORIGINS;
}

export function shellHtmlFor(config: R2Config, env: Record<string, string | undefined> = process.env): string {
  return embedShellHtml({ storageOrigin: new URL(config.endpoint).origin, parentOrigins: embedParentOrigins(env) });
}

export function embedShellUrl(config: R2Config | null, now = Date.now()): AssetUrl | null {
  return config ? viewUrl(config, EMBED_SHELL_KEY, EMBED_SHELL_TYPE, now) : null;
}

export async function uploadEmbedShell(config: R2Config, env: Record<string, string | undefined> = process.env): Promise<void> {
  await putObject(config, EMBED_SHELL_KEY, new TextEncoder().encode(shellHtmlFor(config, env)), EMBED_SHELL_TYPE);
}

let shellChecked: Promise<void> | null = null;

/** Uploads the shell if this bucket has none yet. Checked once per server instance. */
export function ensureEmbedShell(config: R2Config): Promise<void> {
  shellChecked ??= (async () => {
    if (!(await objectExists(config, EMBED_SHELL_KEY))) await uploadEmbedShell(config);
  })().catch(error => {
    shellChecked = null;
    throw error;
  });
  return shellChecked;
}

const META_REFRESH = /<meta\b[^>]*http-equiv\s*=\s*["']?\s*refresh/i;

/** What the server can check when it sees the bytes (base64 uploads). Null when acceptable. */
export function embedHtmlProblem(bytes: Uint8Array): string | null {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return "Embed HTML must be UTF-8";
  }
  if (text.includes("\u0000")) return "Embed HTML must not contain NUL bytes";
  if (META_REFRESH.test(text)) return "Embed HTML must not use <meta http-equiv=refresh>";
  return null;
}
