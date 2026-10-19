import { createHash, randomBytes } from "node:crypto";
import {
  ASSET_LIB,
  ASSET_REF_PATTERN,
  MAX_NOTE_ASSETS,
  MAX_NOTE_ASSET_BYTES,
  STORAGE_STOP_BYTES,
  STORAGE_WARN_BYTES,
  type StoredAsset,
} from "./assetIndex";
import { duplicateNoteContent, rewriteAssetReferences } from "./duplicate-content";
import {
  clearOrphanAssetNamespace,
  newAssetId,
  objectKey,
  scheduleOrphanAssetNamespace,
  storedContentType,
} from "./assets";
import { previewFromMarkdown } from "./preview";
import { redis } from "./redis";
import { storagePrefix } from "./namespace";
import { CREATOR_LIB, MAX_CONTENT_BYTES, noteKey, type Note } from "./notes";
import { deleteObject, getObject, putObject, type R2Config } from "./r2";
import { deliverStorageAlert, runAfter } from "./assetJobs";

export { duplicateNoteContent, rewriteAssetReferences } from "./duplicate-content";

export const DUPLICATES_PER_HOUR = 10;

const legacyKey = (key: string) => `${storagePrefix()}content:${key}`;
const newAssetNs = () => randomBytes(12).toString("base64url");

const duplicateRateKey = (kind: "note" | "client", id: string) =>
  `${storagePrefix()}rl:dup:${kind}:${createHash("sha256").update(id).digest("hex").slice(0, 32)}`;

/**
 * KEYS: dest hash, dest legacy, source hash. ARGV: prefix, source key, dest key,
 * content, now, title, asset_ns, assets json, copy_creator ('1' or '').
 */
const DUPLICATE_SCRIPT = `
local PREFIX = ARGV[1]
${CREATOR_LIB}
${ASSET_LIB}
local destH, destLegacy, sourceH = KEYS[1], KEYS[2], KEYS[3]
if redis.call('EXISTS', destH) == 1 or redis.call('EXISTS', destLegacy) == 1 then return {'exists'} end
if redis.call('EXISTS', sourceH) == 0 then return {'not_found'} end
local content, now, title, ns, assetsJson = ARGV[4], ARGV[5], ARGV[6], ARGV[7], ARGV[8]
local copyCreator = ARGV[9] == '1'
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
  redis.call('ZREM', asset_key('sweep'), ns .. '|')
end
if copyCreator and cid then
  redis.call('HSET', destH, 'cid', cid, 'tags', tags)
  redis.call('ZADD', cidx(cid), now, ARGV[3])
  for _, t in ipairs(decode_tags(tags)) do addtag(cid, ARGV[3], t) end
  evict(cid)
end
return {'ok'}
`;

const STORAGE_CHECK_SCRIPT = `
local PREFIX = ARGV[1]
${ASSET_LIB}
local addBytes = tonumber(ARGV[2]) or 0
local total = tonumber(redis.call('GET', asset_key('bytes'))) or 0
if total + addBytes > ${STORAGE_STOP_BYTES} then
  local first = redis.call('HSETNX', asset_key('alerts'), 'stop', ARGV[3])
  return {'storage_full', tostring(first), tostring(total)}
end
local warn = 0
local after = total + addBytes
if after >= ${STORAGE_WARN_BYTES} then warn = redis.call('HSETNX', asset_key('alerts'), 'warn', ARGV[3]) end
return {'ok', tostring(warn), tostring(after)}
`;

export type DuplicateResult =
  | { ok: true; key: string; warn: boolean }
  | { ok: false; reason: "not_found" | "exists" | "storage_full" | "too_large" | "copy_failed" | "too_many" | "note_full" | "rate_limited"; retryAfter?: number; alert?: boolean; totalBytes?: number };

function referencedAssetIds(content: string): string[] {
  const ids = new Set<string>();
  for (const match of content.matchAll(ASSET_REF_PATTERN)) ids.add(match[1]);
  return [...ids];
}

function copyableAssetIds(content: string, source: Note): string[] {
  if (!source.assetNs) return [];
  return referencedAssetIds(content).filter((id) => Boolean(source.assets[id]));
}

export async function duplicateRateStatus(
  noteKey: string,
  client: string,
): Promise<{ ok: true } | { ok: false; retryAfter: number }> {
  const keys = [duplicateRateKey("note", noteKey), duplicateRateKey("client", client)];
  const counts = await Promise.all(keys.map((k) => redis.get<number>(k)));
  const max = Math.max(counts[0] ?? 0, counts[1] ?? 0);
  if (max >= DUPLICATES_PER_HOUR) {
    const ttls = await Promise.all(keys.map((k) => redis.ttl(k)));
    const retryAfter = Math.max(1, ...ttls.filter((t) => t > 0));
    return { ok: false, retryAfter };
  }
  return { ok: true };
}

export async function recordDuplicateSuccess(noteKey: string, client: string): Promise<void> {
  for (const key of [duplicateRateKey("note", noteKey), duplicateRateKey("client", client)]) {
    const used = await redis.incr(key);
    if (used === 1) await redis.expire(key, 3600);
  }
}

async function preflightStorage(addBytes: number): Promise<
  | { ok: true; warn: boolean; totalBytes: number }
  | { ok: false; reason: "storage_full"; alert: boolean; totalBytes: number }
> {
  const now = String(Date.now());
  const [kind, warnFlag, total] = await redis.eval<string[], string[]>(
    STORAGE_CHECK_SCRIPT,
    [],
    [storagePrefix(), String(addBytes), now],
  );
  if (kind === "storage_full") {
    return {
      ok: false,
      reason: "storage_full",
      alert: warnFlag === "1",
      totalBytes: Number(total) || 0,
    };
  }
  return { ok: true, warn: warnFlag === "1", totalBytes: Number(total) || 0 };
}

async function copyReferencedAssets(
  config: R2Config,
  source: Note,
  content: string,
): Promise<
  | { ok: true; content: string; assetNs: string; assets: Record<string, StoredAsset> }
  | { ok: false }
> {
  const ids = copyableAssetIds(content, source);
  if (!ids.length) {
    return { ok: true, content, assetNs: "", assets: {} };
  }
  const idMap: Record<string, string> = {};
  const assets: Record<string, StoredAsset> = {};
  const copiedKeys: string[] = [];
  const now = Date.now();
  const ns = newAssetNs();
  await scheduleOrphanAssetNamespace(ns, now);
  try {
    for (const oldId of ids) {
      const asset = source.assets[oldId]!;
      const newId = newAssetId();
      idMap[oldId] = newId;
      const body = await getObject(config, objectKey(source.assetNs!, oldId));
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
    await Promise.allSettled(copiedKeys.map((key) => deleteObject(config, key)));
    await clearOrphanAssetNamespace(ns);
    return { ok: false };
  }
}

async function purgeCopiedAssets(config: R2Config, assetNs: string, assets: Record<string, StoredAsset>) {
  await Promise.allSettled(Object.keys(assets).map((id) => deleteObject(config, objectKey(assetNs, id))));
  await clearOrphanAssetNamespace(assetNs);
}

export async function duplicateNote(
  sourceKey: string,
  destKey: string,
  config: R2Config | null,
  source: Note,
  options: { copyCreator: boolean },
): Promise<DuplicateResult> {
  let content = duplicateNoteContent(source.content);
  if (Buffer.byteLength(content, "utf8") > MAX_CONTENT_BYTES) {
    return { ok: false, reason: "too_large" };
  }

  if ((await redis.exists(noteKey(destKey))) || (await redis.exists(legacyKey(destKey)))) {
    return { ok: false, reason: "exists" };
  }

  const toCopy = copyableAssetIds(content, source);
  const copyBytes = toCopy.reduce((sum, id) => sum + (source.assets[id]?.s ?? 0), 0);
  if (toCopy.length > MAX_NOTE_ASSETS) {
    return { ok: false, reason: "too_many" };
  }
  if (copyBytes > MAX_NOTE_ASSET_BYTES) {
    return { ok: false, reason: "note_full" };
  }

  if (config && copyBytes > 0) {
    const storage = await preflightStorage(copyBytes);
    if (!storage.ok) {
      if (storage.alert) runAfter(() => deliverStorageAlert("stop", storage.totalBytes));
      return { ok: false, reason: "storage_full", alert: storage.alert, totalBytes: storage.totalBytes };
    }
    if (storage.warn) runAfter(() => deliverStorageAlert("warn", storage.totalBytes));
  }

  let assetNs = "";
  let assets: Record<string, StoredAsset> = {};
  if (config && toCopy.length) {
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
      options.copyCreator ? "1" : "",
    ],
  );

  if (result[0] === "ok") return { ok: true, key: destKey, warn: false };
  if (config && assetNs) await purgeCopiedAssets(config, assetNs, assets);
  if (result[0] === "storage_full") return { ok: false, reason: "storage_full" };
  if (result[0] === "exists") return { ok: false, reason: "exists" };
  if (result[0] === "not_found") return { ok: false, reason: "not_found" };
  return { ok: false, reason: "copy_failed" };
}
