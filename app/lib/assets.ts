import { createHash, randomBytes } from "node:crypto";
import { redis } from "./redis";
import { storagePrefix } from "./namespace";
import { noteKey, type Note } from "./notes";
import {
  ASSET_GRACE_MS,
  ASSET_LIB,
  ASSET_RESERVES_PER_HOUR,
  ASSET_TYPES,
  MAX_NOTE_ASSETS,
  MAX_NOTE_ASSET_BYTES,
  STORAGE_STOP_BYTES,
  STORAGE_STOP_REARM_BYTES,
  STORAGE_WARN_BYTES,
  STORAGE_WARN_REARM_BYTES,
  type AssetType,
} from "./assetIndex";
import { presign, type R2Config } from "./r2";

export const UPLOAD_URL_TTL_SECONDS = 600;
const HOUR_MS = 60 * 60 * 1000;

const CONTENT_TYPES: Record<string, AssetType> = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/jpg": "jpeg",
  "image/gif": "gif",
  "image/webp": "webp",
};

export function assetTypeFor(contentType: unknown): AssetType | null {
  if (typeof contentType !== "string") return null;
  return CONTENT_TYPES[contentType.trim().toLowerCase()] ?? null;
}

export const contentTypeOf = (t: AssetType) => `image/${t}`;
export const objectKey = (ns: string, id: string) => `${ns}/${id}`;
export const newAssetId = () => randomBytes(16).toString("base64url");
const newAssetNs = () => randomBytes(12).toString("base64url");
const rateKey = (key: string) => `${storagePrefix()}rl:asset:${createHash("sha256").update(key).digest("hex")}`;

/**
 * KEYS: note hash, rate-limit key. ARGV: prefix, note key, id, type, size,
 * now, candidate asset_ns. One EVAL: limits, rate limit, global storage stop,
 * index entry (unreferenced until content mentions it) and accounting.
 */
const RESERVE_SCRIPT = `
local PREFIX = ARGV[1]
${ASSET_LIB}
local h, rl = KEYS[1], KEYS[2]
local now, size = tonumber(ARGV[6]), tonumber(ARGV[5])
if redis.call('EXISTS', h) == 0 then return {'not_found'} end
local assets = decode_assets(redis.call('HGET', h, 'assets')) or {}
local count, bytes = 0, 0
for _, a in pairs(assets) do count = count + 1; bytes = bytes + (a.s or 0) end
if count >= ${MAX_NOTE_ASSETS} then return {'too_many'} end
if bytes + size > ${MAX_NOTE_ASSET_BYTES} then return {'note_full'} end
local total = tonumber(redis.call('GET', asset_key('bytes'))) or 0
if total + size > ${STORAGE_STOP_BYTES} then
  local first = redis.call('HSETNX', asset_key('alerts'), 'stop', ARGV[6])
  return {'storage_full', tostring(first), tostring(total)}
end
local used = redis.call('INCR', rl)
if used == 1 then redis.call('EXPIRE', rl, 3600) end
if used > ${ASSET_RESERVES_PER_HOUR} then return {'rate_limited', tostring(redis.call('TTL', rl))} end
local ns = redis.call('HGET', h, 'asset_ns')
if not ns then
  ns = ARGV[7]
  redis.call('HSET', h, 'asset_ns', ns)
end
assets[ARGV[3]] = { t = ARGV[4], s = size, c = now, r = now }
redis.call('HSET', h, 'assets', encode_assets(assets))
redis.call('HINCRBY', asset_key('nsbytes'), ns, size)
local after = redis.call('INCRBY', asset_key('bytes'), size)
asset_schedule(h, ns .. '|' .. ARGV[2], assets, now)
local warn = 0
if after >= ${STORAGE_WARN_BYTES} then warn = redis.call('HSETNX', asset_key('alerts'), 'warn', ARGV[6]) end
return {'ok', ns, tostring(warn), tostring(after)}
`;

export type ReserveResult =
  | { ok: true; ns: string; id: string; totalBytes: number; warn: boolean }
  | { ok: false; reason: "not_found" | "too_many" | "note_full" }
  | { ok: false; reason: "rate_limited"; retryAfter: number }
  | { ok: false; reason: "storage_full"; totalBytes: number; alert: boolean };

export async function reserveAsset(key: string, type: AssetType, size: number): Promise<ReserveResult> {
  const id = newAssetId();
  const result = await redis.eval<string[], string[]>(
    RESERVE_SCRIPT,
    [noteKey(key), rateKey(key)],
    [storagePrefix(), key, id, type, String(size), String(Date.now()), newAssetNs()],
  );
  switch (result[0]) {
    case "ok":
      return { ok: true, ns: result[1], id, warn: result[2] === "1", totalBytes: Number(result[3]) };
    case "rate_limited":
      return { ok: false, reason: "rate_limited", retryAfter: Math.max(1, Number(result[1]) || 3600) };
    case "storage_full":
      return { ok: false, reason: "storage_full", alert: result[1] === "1", totalBytes: Number(result[2]) };
    default:
      return { ok: false, reason: result[0] as "not_found" | "too_many" | "note_full" };
  }
}

/** Presigned PUT that locks the type and exact length. */
export function uploadUrl(config: R2Config, ns: string, id: string, type: AssetType, size: number, now = Date.now()) {
  const headers = { "content-type": contentTypeOf(type), "content-length": String(size) };
  return {
    url: presign(config, "PUT", objectKey(ns, id), { now, expiresIn: UPLOAD_URL_TTL_SECONDS, headers }),
    headers: { "Content-Type": headers["content-type"], "Content-Length": headers["content-length"] },
  };
}

export type AssetUrl = { url: string; expires_at: number };

/**
 * Hour-aligned GET URLs: signed at the top of the hour for two hours, so a
 * URL is byte-identical (and browser-cacheable) for the whole hour and stays
 * valid at least an hour after it is minted.
 */
export function assetUrls(config: R2Config | null, note: Pick<Note, "assetNs" | "assets">, now = Date.now()): Record<string, AssetUrl> {
  if (!config || !note.assetNs) return {};
  const signedAt = Math.floor(now / HOUR_MS) * HOUR_MS;
  const expiresAt = signedAt + 2 * HOUR_MS;
  const out: Record<string, AssetUrl> = {};
  for (const [id, asset] of Object.entries(note.assets)) {
    out[id] = {
      url: presign(config, "GET", objectKey(note.assetNs, id), {
        now: signedAt,
        expiresIn: 2 * 3600,
        query: {
          "response-content-type": contentTypeOf(asset.t),
          "response-content-disposition": "inline",
          "response-cache-control": "private, max-age=3600",
        },
      }),
      expires_at: expiresAt,
    };
  }
  return out;
}

/** The agent-facing `assets` list on GET /api/content. */
export function assetSummaries(config: R2Config | null, note: Pick<Note, "assetNs" | "assets">, now = Date.now()) {
  const urls = assetUrls(config, note, now);
  return Object.entries(note.assets)
    .sort(([, a], [, b]) => a.c - b.c)
    .map(([id, asset]) => ({
      id,
      type: contentTypeOf(asset.t),
      size: asset.s,
      created_at: asset.c,
      markdown: `![](marker-asset:${id})`,
      url: urls[id]?.url ?? null,
      expires_at: urls[id]?.expires_at ?? null,
      delete_after: asset.r === undefined ? null : asset.r + ASSET_GRACE_MS,
    }));
}

export const ASSET_TYPE_LIST = ASSET_TYPES.map(contentTypeOf);

/**
 * ARGV: prefix, member, now. Live note: drops images unreferenced past the
 * grace period and reschedules. Gone (deleted, expired, recreated): 'purge'.
 */
const SWEEP_NOTE_SCRIPT = `
local PREFIX = ARGV[1]
${ASSET_LIB}
local member, now = ARGV[2], tonumber(ARGV[3])
local sep = string.find(member, '|', 1, true)
if not sep then
  redis.call('ZREM', asset_key('sweep'), member)
  return {'skip'}
end
local ns, key = string.sub(member, 1, sep - 1), string.sub(member, sep + 1)
local h = PREFIX .. 'note:' .. key
if redis.call('HGET', h, 'asset_ns') ~= ns then return {'purge', ns} end
local assets = decode_assets(redis.call('HGET', h, 'assets')) or {}
local out, freed = {'ok', ns}, 0
for id, a in pairs(assets) do
  if a.r and a.r + ASSET_GRACE <= now then
    out[#out + 1] = id
    freed = freed + (a.s or 0)
    assets[id] = nil
  end
end
if freed > 0 or #out > 2 then
  redis.call('HSET', h, 'assets', encode_assets(assets))
  redis.call('HINCRBY', asset_key('nsbytes'), ns, -freed)
  redis.call('DECRBY', asset_key('bytes'), freed)
end
asset_schedule(h, member, assets, now)
return out
`;

/** ARGV: prefix, member, ns. After the prefix is purged from R2. */
const FINISH_PURGE_SCRIPT = `
local PREFIX = ARGV[1]
${ASSET_LIB}
redis.call('ZREM', asset_key('sweep'), ARGV[2])
local bytes = tonumber(redis.call('HGET', asset_key('nsbytes'), ARGV[3])) or 0
if bytes > 0 then redis.call('DECRBY', asset_key('bytes'), bytes) end
redis.call('HDEL', asset_key('nsbytes'), ARGV[3])
return 'ok'
`;

/**
 * ARGV: prefix, now. Re-arms alerts once usage falls back under the
 * hysteresis line and claims any alert not yet sent. Returns
 * [total bytes, 'warn'|'' , 'stop'|''].
 */
const ALERT_SCRIPT = `
local PREFIX = ARGV[1]
${ASSET_LIB}
local total = tonumber(redis.call('GET', asset_key('bytes'))) or 0
if total < 0 then
  redis.call('SET', asset_key('bytes'), 0)
  total = 0
end
local alerts = asset_key('alerts')
if total < ${STORAGE_WARN_REARM_BYTES} then redis.call('HDEL', alerts, 'warn') end
if total < ${STORAGE_STOP_REARM_BYTES} then redis.call('HDEL', alerts, 'stop') end
local warn = total >= ${STORAGE_WARN_BYTES} and redis.call('HSETNX', alerts, 'warn', ARGV[2]) == 1
return { tostring(total), warn and 'warn' or '' }
`;

export type SweepVisit = { kind: "purge"; ns: string } | { kind: "ok"; ns: string; removed: string[] } | { kind: "skip" };

export async function dueSweepMembers(now = Date.now(), limit = 500): Promise<string[]> {
  return redis.zrange<string[]>(`${storagePrefix()}assets:sweep`, "-inf", now, { byScore: true, offset: 0, count: limit });
}

export async function visitSweepMember(member: string, now = Date.now()): Promise<SweepVisit> {
  const [kind, ns, ...removed] = await redis.eval<string[], string[]>(SWEEP_NOTE_SCRIPT, [], [storagePrefix(), member, String(now)]);
  if (kind === "purge") return { kind, ns };
  if (kind === "ok") return { kind, ns, removed };
  return { kind: "skip" };
}

export async function finishPurge(member: string, ns: string): Promise<void> {
  await redis.eval(FINISH_PURGE_SCRIPT, [], [storagePrefix(), member, ns]);
}

export async function claimStorageAlerts(now = Date.now()): Promise<{ totalBytes: number; warn: boolean }> {
  const [total, warn] = await redis.eval<string[], string[]>(ALERT_SCRIPT, [], [storagePrefix(), String(now)]);
  return { totalBytes: Number(total) || 0, warn: warn === "warn" };
}

/** Lets a failed alert email be retried by the next sweep. */
export async function releaseStorageAlert(kind: "warn" | "stop"): Promise<void> {
  await redis.hdel(`${storagePrefix()}assets:alerts`, kind);
}
