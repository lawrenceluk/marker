import { randomBytes } from "node:crypto";
import { ASSET_LIB, ASSET_REF_PATTERN, STORAGE_STOP_BYTES, type StoredAsset } from "./assetIndex";
import { duplicateNoteContent, rewriteAssetReferences } from "./duplicate-content";
import { newAssetId, objectKey, storedContentType } from "./assets";
import { previewFromMarkdown } from "./preview";
import { redis } from "./redis";
import { storagePrefix } from "./namespace";
import { CREATOR_LIB, MAX_CONTENT_BYTES, noteKey, type Note } from "./notes";
import { deleteObject, getObject, putObject, type R2Config } from "./r2";

export { duplicateNoteContent, rewriteAssetReferences } from "./duplicate-content";

const legacyKey = (key: string) => `${storagePrefix()}content:${key}`;
const newAssetNs = () => randomBytes(12).toString("base64url");

/**
 * KEYS: dest hash, dest legacy, source hash. ARGV: prefix, source key, dest key,
 * content, now, title, asset_ns, assets json.
 */
const DUPLICATE_SCRIPT = `
local PREFIX = ARGV[1]
${CREATOR_LIB}
${ASSET_LIB}
local destH, destLegacy, sourceH = KEYS[1], KEYS[2], KEYS[3]
if redis.call('EXISTS', destH) == 1 or redis.call('EXISTS', destLegacy) == 1 then return {'exists'} end
if redis.call('EXISTS', sourceH) == 0 then return {'not_found'} end
local content, now, title, ns, assetsJson = ARGV[4], ARGV[5], ARGV[6], ARGV[7], ARGV[8]
local assets = decode_assets(assetsJson) or {}
local addBytes = 0
for _, a in pairs(assets) do addBytes = addBytes + (a.s or 0) end
if addBytes > 0 then
  local total = tonumber(redis.call('GET', asset_key('bytes'))) or 0
  if total + addBytes > ${STORAGE_STOP_BYTES} then return {'storage_full'} end
end
local sf = redis.call('HMGET', sourceH, 'cid', 'tags')
local cid, tags = sf[1], sf[2] or '[]'
redis.call('HSET', destH,
  'content', content,
  'comments', '[]',
  'responses', '[]',
  'rev', '1',
  'updated_at', now,
  'created_at', now,
  'title', title,
  'seen_rev', '1',
  'seen_at', now
)
redis.call('PERSIST', destH)
if ns ~= '' then
  redis.call('HSET', destH, 'asset_ns', ns, 'assets', assetsJson)
  if addBytes > 0 then
    redis.call('INCRBY', asset_key('bytes'), addBytes)
    redis.call('HINCRBY', asset_key('nsbytes'), ns, addBytes)
  end
  asset_schedule(destH, ns .. '|' .. ARGV[3], assets, tonumber(now))
end
if cid then
  redis.call('HSET', destH, 'cid', cid, 'tags', tags)
  redis.call('ZADD', cidx(cid), now, ARGV[3])
  for _, t in ipairs(decode_tags(tags)) do addtag(cid, ARGV[3], t) end
  evict(cid)
end
return {'ok'}
`;

export type DuplicateResult =
  | { ok: true; key: string }
  | { ok: false; reason: "not_found" | "exists" | "storage_full" | "too_large" | "copy_failed" };

function referencedAssetIds(content: string): string[] {
  const ids = new Set<string>();
  for (const match of content.matchAll(ASSET_REF_PATTERN)) ids.add(match[1]);
  return [...ids];
}

async function copyReferencedAssets(
  config: R2Config,
  source: Note,
  content: string,
): Promise<
  | { ok: true; content: string; assetNs: string; assets: Record<string, StoredAsset> }
  | { ok: false }
> {
  const ids = referencedAssetIds(content);
  if (!ids.length || !source.assetNs) {
    return { ok: true, content, assetNs: "", assets: {} };
  }
  const idMap: Record<string, string> = {};
  const assets: Record<string, StoredAsset> = {};
  const copiedKeys: string[] = [];
  const now = Date.now();
  const ns = newAssetNs();
  try {
    for (const oldId of ids) {
      const asset = source.assets[oldId];
      if (!asset) continue;
      const newId = newAssetId();
      idMap[oldId] = newId;
      const body = await getObject(config, objectKey(source.assetNs, oldId));
      const destKey = objectKey(ns, newId);
      await putObject(config, destKey, body, storedContentType(asset.t));
      copiedKeys.push(destKey);
      assets[newId] = { t: asset.t, s: asset.s, c: now };
    }
    return {
      ok: true,
      content: rewriteAssetReferences(content, idMap),
      assetNs: ns,
      assets,
    };
  } catch {
    await Promise.allSettled(copiedKeys.map(key => deleteObject(config, key)));
    return { ok: false };
  }
}

async function purgeCopiedAssets(config: R2Config, assetNs: string, assets: Record<string, StoredAsset>) {
  await Promise.allSettled(Object.keys(assets).map(id => deleteObject(config, objectKey(assetNs, id))));
}

export async function duplicateNote(
  sourceKey: string,
  destKey: string,
  config: R2Config | null,
  source: Note,
): Promise<DuplicateResult> {
  let content = duplicateNoteContent(source.content);
  if (Buffer.byteLength(content, "utf8") > MAX_CONTENT_BYTES) {
    return { ok: false, reason: "too_large" };
  }

  if (await redis.exists(noteKey(destKey), legacyKey(destKey))) {
    return { ok: false, reason: "exists" };
  }

  let assetNs = "";
  let assets: Record<string, StoredAsset> = {};
  if (config && source.assetNs && referencedAssetIds(content).length) {
    const copied = await copyReferencedAssets(config, source, content);
    if (!copied.ok) return { ok: false, reason: "copy_failed" };
    content = copied.content;
    assetNs = copied.assetNs;
    assets = copied.assets;
  }

  const title = previewFromMarkdown(content)?.title ?? "";
  const now = String(Date.now());
  const result = await redis.eval<string[], string[]>(
    DUPLICATE_SCRIPT,
    [noteKey(destKey), legacyKey(destKey), noteKey(sourceKey)],
    [
      storagePrefix(),
      sourceKey,
      destKey,
      content,
      now,
      title,
      assetNs,
      JSON.stringify(assets),
    ],
  );

  if (result[0] === "ok") return { ok: true, key: destKey };
  if (config && assetNs) await purgeCopiedAssets(config, assetNs, assets);
  if (result[0] === "storage_full") return { ok: false, reason: "storage_full" };
  if (result[0] === "exists") return { ok: false, reason: "exists" };
  if (result[0] === "not_found") return { ok: false, reason: "not_found" };
  return { ok: false, reason: "copy_failed" };
}
