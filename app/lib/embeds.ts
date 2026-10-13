import { createHash } from "node:crypto";
import type { StoredAsset } from "./assetIndex";
import { embedShellHtml } from "./embedShell";
import { objectExists, putObject, viewUrl, type AssetUrl, type R2Config } from "./r2";

export const EMBED_SHELL_PREFIX = "embed-shell-";
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

/**
 * Named after a hash of its own HTML, so any change to the shell or to
 * EMBED_PARENT_ORIGINS is a new object and a bucket never serves a stale copy.
 * Kept at the bucket root, outside every `<asset_ns>/` prefix, so the sweep never touches it.
 */
export function embedShellKey(config: R2Config, env: Record<string, string | undefined> = process.env): string {
  const hash = createHash("sha256").update(shellHtmlFor(config, env)).digest("hex").slice(0, 16);
  return `${EMBED_SHELL_PREFIX}${hash}.html`;
}

export function embedShellUrl(config: R2Config | null, now = Date.now()): AssetUrl | null {
  return config ? viewUrl(config, embedShellKey(config), EMBED_SHELL_TYPE, now) : null;
}

export async function uploadEmbedShell(config: R2Config, env: Record<string, string | undefined> = process.env): Promise<string> {
  const key = embedShellKey(config, env);
  await putObject(config, key, new TextEncoder().encode(shellHtmlFor(config, env)), EMBED_SHELL_TYPE);
  return key;
}

const shellChecked = new Map<string, Promise<void>>();

/** Uploads this build's shell if the bucket lacks it. Checked once per server instance and shell. */
export function ensureEmbedShell(config: R2Config): Promise<void> {
  const key = `${config.endpoint} ${config.bucket} ${embedShellKey(config)}`;
  let checked = shellChecked.get(key);
  if (!checked) {
    checked = (async () => {
      if (!(await objectExists(config, embedShellKey(config)))) await uploadEmbedShell(config);
    })().catch(error => {
      shellChecked.delete(key);
      throw error;
    });
    shellChecked.set(key, checked);
  }
  return checked;
}

export const hasEmbeds = (note: { assets: Record<string, StoredAsset> } | null): boolean =>
  !!note && Object.values(note.assets).some(asset => asset.t === "html");

/** For pages and URL refreshes: a missing shell is fixed here rather than breaking every embed. */
export async function shellForNote(config: R2Config | null, note: { assets: Record<string, StoredAsset> } | null): Promise<AssetUrl | null> {
  if (!config || !hasEmbeds(note)) return null;
  await ensureEmbedShell(config).catch(error => console.error("[marker] embed shell upload failed:", error));
  return embedShellUrl(config);
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
