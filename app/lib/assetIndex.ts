/**
 * Per-note image index, stored on the note hash so rename, TTL and delete
 * carry it with no extra keys:
 *   `asset_ns` random R2 prefix; objects live at `<asset_ns>/<asset id>`
 *   `assets`   JSON { <id>: { t: "png"|"jpeg"|"gif"|"webp", s: bytes, c: createdMs, r?: unreferencedSinceMs } }
 * Global keys under the storage prefix:
 *   `assets:sweep`   ZSET `<asset_ns>|<note key>` -> when the daily sweep must next look
 *   `assets:bytes`   STRING reserved bytes across all notes
 *   `assets:nsbytes` HASH asset_ns -> bytes, so an expired note's bytes can still be freed
 *   `assets:alerts`  HASH warn|stop -> ms the alert was raised (one email per crossing)
 */

export const ASSET_TYPES = ["png", "jpeg", "gif", "webp"] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export const MAX_ASSET_BYTES = 5 * 1024 * 1024;
export const MAX_BASE64_BYTES = 1024 * 1024;
export const MAX_NOTE_ASSET_BYTES = 50 * 1024 * 1024;
export const MAX_NOTE_ASSETS = 100;
export const ASSET_RESERVES_PER_HOUR = 60;
/** Unreferenced images are deleted this long after they leave the note. */
export const ASSET_GRACE_MS = 24 * 60 * 60 * 1000;
/** Decimal GB, so the thresholds sit safely under R2's 10 GB free tier. */
export const STORAGE_WARN_BYTES = 8e9;
export const STORAGE_STOP_BYTES = 9.5e9;
/** Hysteresis before an alert can fire again. */
export const STORAGE_WARN_REARM_BYTES = 7.5e9;
export const STORAGE_STOP_REARM_BYTES = 9e9;

export const ASSET_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
export const ASSET_REF_PATTERN = /marker-asset:([A-Za-z0-9_-]{22})/g;

export type StoredAsset = { t: AssetType; s: number; c: number; r?: number };

export function parseAssets(raw: string | null | undefined): Record<string, StoredAsset> {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const out: Record<string, StoredAsset> = {};
    for (const [id, a] of Object.entries(value as Record<string, StoredAsset>)) {
      if (ASSET_ID_PATTERN.test(id) && a && ASSET_TYPES.includes(a.t) && Number.isFinite(a.s)) out[id] = a;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Lua shared by the note scripts and the asset scripts. Each script declares
 * `local PREFIX` before this chunk.
 */
export const ASSET_LIB = `
local ASSET_GRACE = ${ASSET_GRACE_MS}
local function asset_key(s) return PREFIX .. 'assets:' .. s end
local function decode_assets(s)
  if not s or s == '' then return nil end
  local ok, v = pcall(cjson.decode, s)
  if ok and type(v) == 'table' then return v end
  return nil
end
local function encode_assets(a)
  if next(a) == nil then return '{}' end
  return cjson.encode(a)
end
-- Next visit for the sweep: the earliest grace deadline of an unreferenced
-- image, or the note's expiry. No images means nothing to sweep.
local function asset_schedule(h, member, assets, now)
  local due = false
  if next(assets) ~= nil then
    for _, a in pairs(assets) do
      if a.r then
        local d = a.r + ASSET_GRACE
        if not due or d < due then due = d end
      end
    end
    local pttl = redis.call('PTTL', h)
    if pttl >= 0 and (not due or now + pttl < due) then due = now + pttl end
  end
  if due then redis.call('ZADD', asset_key('sweep'), due, member)
  else redis.call('ZREM', asset_key('sweep'), member) end
end
-- After a content commit: images the content references lose their removal
-- mark; images it no longer references get one (kept if already marked).
local function asset_refs(h, key, content, now)
  local assets = decode_assets(redis.call('HGET', h, 'assets'))
  if not assets then return end
  local ns = redis.call('HGET', h, 'asset_ns')
  if not ns then return end
  local seen = {}
  for id in string.gmatch(content, 'marker%-asset:([%w_%-]+)') do seen[id] = true end
  for id, a in pairs(assets) do
    if seen[id] then a.r = nil elseif not a.r then a.r = now end
  end
  redis.call('HSET', h, 'assets', encode_assets(assets))
  asset_schedule(h, ns .. '|' .. key, assets, now)
end
`;
