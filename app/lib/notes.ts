import { redis } from "./redis";
import type { Thread } from "./comments";
import { remapComments } from "./remap-comments";
import { storagePrefix } from "./namespace";

/** Maximum size of a stored note, in bytes. */
export const MAX_CONTENT_BYTES = 1024 * 1024; // 1 MiB
export const MAX_TTL_SECONDS = 60 * 60 * 24 * 365; // 1 year

export const WRITE_MODES = ["overwrite", "append", "prepend"] as const;
export type WriteMode = (typeof WRITE_MODES)[number];

export type Note = {
  content: string;
  comments: Thread[];
  rev: number;
  updatedAt: number | null;
  createdAt: number | null;
  expiresAt: number | null;
};

export type WriteResult =
  | {
      ok: true;
      rev: number;
      updatedAt: number;
      expiresAt: number | null;
      size: number;
    }
  | { ok: false; reason: "conflict"; rev: number; content: string }
  | { ok: false; reason: "too_large"; size: number };

export type RenameResult =
  | { ok: true }
  | { ok: false; reason: "exists" }
  | { ok: false; reason: "not_found" };

/** Note hash: fields `content`, `rev`, `updated_at`, `created_at`. */
const noteKey = (key: string) => `${storagePrefix()}note:${key}`;
/** Pre-metadata schema: a bare string. Read through to it, migrate on write. */
const legacyKey = (key: string) => `${storagePrefix()}content:${key}`;

/**
 * KEYS: note hash, legacy string.
 * Returns [content, rev, updated_at, created_at, pttl] or nil.
 */
const READ_SCRIPT = `
local h, legacy = KEYS[1], KEYS[2]

if redis.call('EXISTS', h) == 1 then
  local f = redis.call('HMGET', h, 'content', 'rev', 'updated_at', 'created_at')
  return { f[1] or '', f[2] or '0', f[3] or '', f[4] or '', tostring(redis.call('PTTL', h)), ARGV[1] == '1' and (redis.call('HGET', h, 'comments') or '[]') or '[]' }
end

local old = redis.call('GET', legacy)
if old then
  return { old, '0', '', '', '-1', '[]' }
end

return nil
`;

/** All writes commit content + anchors under the snapshot revision. TTL stays inside Lua. */
const COMMIT_SCRIPT = `
local h, legacy = KEYS[1], KEYS[2]
local exists = redis.call('EXISTS', h) == 1
local old = not exists and redis.call('GET', legacy) or false
local present = exists or old ~= false
local rev = tonumber(redis.call('HGET', h, 'rev')) or 0
local current = exists and (redis.call('HGET', h, 'content') or '') or old or ''
local comments = redis.call('HGET', h, 'comments') or '[]'
if ARGV[7] == '1' and not present then return {'missing'} end
if (ARGV[7] == '1') ~= present or rev ~= tonumber(ARGV[1]) or current ~= ARGV[2] or comments ~= ARGV[3] then
  return {'conflict', tostring(rev), current}
end
if #ARGV[4] > tonumber(ARGV[9]) then return {'too_large', tostring(#ARGV[4])} end
local pttl = redis.call('PTTL', exists and h or legacy)
local created = redis.call('HGET', h, 'created_at') or ARGV[6]
redis.call('HSET', h, 'content', ARGV[4], 'comments', ARGV[5], 'rev', rev + 1, 'updated_at', ARGV[6], 'created_at', created)
if ARGV[8] == '0' then redis.call('PERSIST', h)
elseif ARGV[8] ~= '' then redis.call('EXPIRE', h, tonumber(ARGV[8]))
elseif not exists and pttl >= 0 then redis.call('PEXPIRE', h, pttl) end
redis.call('DEL', legacy)
return {'ok', tostring(rev + 1), tostring(redis.call('PTTL', h)), tostring(#ARGV[4])}
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

export async function readNote(
  key: string,
  includeComments = false,
): Promise<Note | null> {
  const result = await redis.eval<string[], string[] | null>(
    READ_SCRIPT,
    [noteKey(key), legacyKey(key)],
    [includeComments ? "1" : "0"],
  );

  if (!result) return null;

  const [content, rev, updatedAt, createdAt, pttl, comments] = result;
  return {
    content,
    comments: JSON.parse(comments),
    rev: Number(rev) || 0,
    updatedAt: toNumberOrNull(updatedAt),
    createdAt: toNumberOrNull(createdAt),
    expiresAt: expiryFromPttl(Number(pttl), Date.now()),
  };
}

async function commitNote(
  key: string,
  before: Note | null,
  content: string,
  comments: Thread[],
  ttl?: number | null,
): Promise<WriteResult | { ok: false; reason: "missing" }> {
  const now = Date.now();
  const result = await redis.eval<string[], string[]>(
    COMMIT_SCRIPT,
    [noteKey(key), legacyKey(key)],
    [
      String(before?.rev ?? 0),
      before?.content ?? "",
      JSON.stringify(before?.comments ?? []),
      content,
      JSON.stringify(comments),
      String(now),
      before ? "1" : "0",
      ttl === undefined ? "" : String(ttl ?? 0),
      String(MAX_CONTENT_BYTES),
    ],
  );
  if (result[0] === "missing") return { ok: false, reason: "missing" };
  if (result[0] === "conflict")
    return {
      ok: false,
      reason: "conflict",
      rev: Number(result[1]),
      content: result[2],
    };
  if (result[0] === "too_large")
    return { ok: false, reason: "too_large", size: Number(result[1]) };
  return {
    ok: true,
    rev: Number(result[1]),
    updatedAt: now,
    expiresAt: expiryFromPttl(Number(result[2]), now),
    size: Number(result[3]),
  };
}

export async function writeNote(
  key: string,
  content: string,
  options: { mode?: WriteMode; ifRev?: number; ttl?: number | null } = {},
): Promise<WriteResult> {
  const { mode = "overwrite", ifRev, ttl } = options;
  for (let attempt = 0; attempt < 8; attempt++) {
    const before = await readNote(key, true);
    const current = before?.content ?? "",
      rev = before?.rev ?? 0;
    if (ifRev !== undefined && ifRev !== rev)
      return { ok: false, reason: "conflict", rev, content: current };
    const next =
      mode === "append"
        ? current + (current && !current.endsWith("\n") ? "\n" : "") + content
        : mode === "prepend"
          ? content +
            (content && current && !content.endsWith("\n") ? "\n" : "") +
            current
          : content;
    const size = Buffer.byteLength(next, "utf8");
    if (size > MAX_CONTENT_BYTES)
      return { ok: false, reason: "too_large", size };
    const comments = remapComments(current, next, before?.comments ?? [], mode);
    const result = await commitNote(key, before, next, comments, ttl);
    if (result.ok || result.reason === "too_large") return result;
    if (ifRev !== undefined)
      return result.reason === "missing"
        ? { ok: false, reason: "conflict", rev: 0, content: "" }
        : result;
    // Old unconditional clients retain append/overwrite behavior: reread, rediff, CAS.
  }
  const latest = await readNote(key);
  return {
    ok: false,
    reason: "conflict",
    rev: latest?.rev ?? 0,
    content: latest?.content ?? "",
  };
}

export async function renameNote(
  from: string,
  to: string,
): Promise<RenameResult> {
  if (from === to) {
    return { ok: true };
  }

  const result = await redis.eval<string[], string[]>(
    RENAME_SCRIPT,
    [noteKey(from), legacyKey(from), noteKey(to), legacyKey(to)],
    [],
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

/** Remove both the hash note and any legacy string for this key. */
export async function deleteNote(key: string): Promise<void> {
  await redis.del(noteKey(key), legacyKey(key));
}

/** Operations and mapped anchors share the content commit; no separate anchor write. */
export async function commitComments(
  key: string,
  before: Note,
  content: string,
  comments: Thread[],
): Promise<
  { status: "ok"; comments: Thread[] } | { status: "conflict" | "missing" }
> {
  const mapped = remapComments(before.content, content, comments);
  const result = await commitNote(key, before, content, mapped);
  if (!result.ok)
    return { status: result.reason === "missing" ? "missing" : "conflict" };
  return { status: "ok", comments: mapped };
}
