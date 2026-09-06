import { redis } from "./redis";

/** Maximum size of a stored note, in bytes. */
export const MAX_CONTENT_BYTES = 1024 * 1024; // 1 MiB
export const MAX_TTL_SECONDS = 60 * 60 * 24 * 365; // 1 year

export const WRITE_MODES = ["overwrite", "append", "prepend"] as const;
export type WriteMode = (typeof WRITE_MODES)[number];

export type Note = {
  content: string;
  rev: number;
  updatedAt: number | null;
  createdAt: number | null;
  expiresAt: number | null;
};

export type WriteResult =
  | { ok: true; rev: number; updatedAt: number; expiresAt: number | null; size: number }
  | { ok: false; reason: "conflict"; rev: number; content: string }
  | { ok: false; reason: "too_large"; size: number };

export type RenameResult =
  | { ok: true }
  | { ok: false; reason: "exists" }
  | { ok: false; reason: "not_found" };

/** Note hash: fields `content`, `rev`, `updated_at`, `created_at`. */
const noteKey = (key: string) => `note:${key}`;
/** Pre-metadata schema: a bare string. Read through to it, migrate on write. */
const legacyKey = (key: string) => `content:${key}`;

/**
 * KEYS: note hash, legacy string.
 * Returns [content, rev, updated_at, created_at, pttl] or nil.
 */
const READ_SCRIPT = `
local h, legacy = KEYS[1], KEYS[2]

if redis.call('EXISTS', h) == 1 then
  local f = redis.call('HMGET', h, 'content', 'rev', 'updated_at', 'created_at')
  return { f[1] or '', f[2] or '0', f[3] or '', f[4] or '', tostring(redis.call('PTTL', h)) }
end

local old = redis.call('GET', legacy)
if old then
  return { old, '0', '', '', '-1' }
end

return nil
`;

/**
 * KEYS: note hash, legacy string.
 * ARGV: mode, payload, now(ms), ifRev ('' = unconditional),
 *       ttl ('' = leave as-is, '0' = clear, N = seconds), maxBytes.
 *
 * Read-modify-write happens inside the script so concurrent writers can't
 * interleave: this is what makes append and if_rev safe for multiple agents.
 */
const WRITE_SCRIPT = `
local h, legacy = KEYS[1], KEYS[2]
local mode, payload, now, ifRev, ttl = ARGV[1], ARGV[2], ARGV[3], ARGV[4], ARGV[5]
local maxBytes = tonumber(ARGV[6])

local current, rev, created = '', 0, now

if redis.call('EXISTS', h) == 1 then
  local f = redis.call('HMGET', h, 'content', 'rev', 'created_at')
  current = f[1] or ''
  rev = tonumber(f[2]) or 0
  created = f[3] or now
else
  current = redis.call('GET', legacy) or ''
end

if ifRev ~= '' and tonumber(ifRev) ~= rev then
  return { 'conflict', tostring(rev), current }
end

local nextContent
if mode == 'append' then
  if #current > 0 and string.sub(current, -1) ~= '\\n' then
    nextContent = current .. '\\n' .. payload
  else
    nextContent = current .. payload
  end
elseif mode == 'prepend' then
  if #payload > 0 and #current > 0 and string.sub(payload, -1) ~= '\\n' then
    nextContent = payload .. '\\n' .. current
  else
    nextContent = payload .. current
  end
else
  nextContent = payload
end

if #nextContent > maxBytes then
  return { 'too_large', tostring(#nextContent) }
end

rev = rev + 1
redis.call('HSET', h, 'content', nextContent, 'rev', rev, 'updated_at', now, 'created_at', created)
redis.call('DEL', legacy)

if ttl == '0' then
  redis.call('PERSIST', h)
elseif ttl ~= '' then
  redis.call('EXPIRE', h, tonumber(ttl))
end

return { 'ok', tostring(rev), tostring(redis.call('PTTL', h)), tostring(#nextContent) }
`;

/**
 * KEYS: old hash, old legacy, new hash, new legacy.
 * Moves a note to a new key without rewriting content. RENAME keeps hash
 * fields, rev, and TTL. Destination must be free.
 */
const RENAME_SCRIPT = `
local oldH, oldLegacy, newH, newLegacy = KEYS[1], KEYS[2], KEYS[3], KEYS[4]

if oldH == newH then
  return { 'ok' }
end

if redis.call('EXISTS', newH) == 1 or redis.call('EXISTS', newLegacy) == 1 then
  return { 'exists' }
end

local moved = false

if redis.call('EXISTS', oldH) == 1 then
  redis.call('RENAME', oldH, newH)
  moved = true
end

if redis.call('EXISTS', oldLegacy) == 1 then
  if moved then
    redis.call('DEL', oldLegacy)
  else
    local content = redis.call('GET', oldLegacy)
    local pttl = redis.call('PTTL', oldLegacy)
    redis.call('HSET', newH, 'content', content or '', 'rev', '0', 'updated_at', '', 'created_at', '')
    if pttl > 0 then
      redis.call('PEXPIRE', newH, pttl)
    end
    redis.call('DEL', oldLegacy)
    moved = true
  end
end

if not moved then
  return { 'not_found' }
end

return { 'ok' }
`;

/** PTTL reports -1 for "no expiry" and -2 for "no such key". */
function expiryFromPttl(pttl: number, now: number): number | null {
  return pttl < 0 ? null : now + pttl;
}

function toNumberOrNull(value: string): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function readNote(key: string): Promise<Note | null> {
  const result = await redis.eval<string[], string[] | null>(
    READ_SCRIPT,
    [noteKey(key), legacyKey(key)],
    []
  );

  if (!result) return null;

  const [content, rev, updatedAt, createdAt, pttl] = result;
  return {
    content,
    rev: Number(rev) || 0,
    updatedAt: toNumberOrNull(updatedAt),
    createdAt: toNumberOrNull(createdAt),
    expiresAt: expiryFromPttl(Number(pttl), Date.now()),
  };
}

export async function writeNote(
  key: string,
  content: string,
  options: { mode?: WriteMode; ifRev?: number; ttl?: number | null } = {}
): Promise<WriteResult> {
  const { mode = "overwrite", ifRev, ttl } = options;
  const now = Date.now();

  const result = await redis.eval<string[], string[]>(
    WRITE_SCRIPT,
    [noteKey(key), legacyKey(key)],
    [
      mode,
      content,
      String(now),
      ifRev === undefined ? "" : String(ifRev),
      ttl === undefined ? "" : String(ttl ?? 0),
      String(MAX_CONTENT_BYTES),
    ]
  );

  const [status] = result;

  if (status === "conflict") {
    return { ok: false, reason: "conflict", rev: Number(result[1]), content: result[2] };
  }

  if (status === "too_large") {
    return { ok: false, reason: "too_large", size: Number(result[1]) };
  }

  return {
    ok: true,
    rev: Number(result[1]),
    updatedAt: now,
    expiresAt: expiryFromPttl(Number(result[2]), now),
    size: Number(result[3]),
  };
}

export async function renameNote(
  from: string,
  to: string
): Promise<RenameResult> {
  if (from === to) {
    return { ok: true };
  }

  const result = await redis.eval<string[], string[]>(
    RENAME_SCRIPT,
    [noteKey(from), legacyKey(from), noteKey(to), legacyKey(to)],
    []
  );

  const [status] = result;
  if (status === "exists") {
    return { ok: false, reason: "exists" };
  }
  if (status === "not_found") {
    return { ok: false, reason: "not_found" };
  }
  return { ok: true };
}
