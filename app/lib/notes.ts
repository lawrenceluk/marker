import { redis } from "./redis";
import type { Thread } from "./comments";
import type { ResponseEntry } from "./responses";
import { remapComments } from "./remap-comments";
import { storagePrefix } from "./namespace";
import { previewFromMarkdown } from "./preview";
import { ASSET_LIB, parseAssets, type StoredAsset } from "./assetIndex";

/** Maximum size of a stored note, in bytes. */
export const MAX_CONTENT_BYTES = 1024 * 1024; // 1 MiB
export const MAX_TTL_SECONDS = 60 * 60 * 24 * 365; // 1 year
const ACCESS_THROTTLE_MS = 60 * 60 * 1000;
/** Index cap per creator; the least recently updated note is evicted past it. */
export const MAX_CREATOR_NOTES = 2000;

export const WRITE_MODES = ["overwrite", "append", "prepend"] as const;
export type WriteMode = (typeof WRITE_MODES)[number];

export type Note = {
  content: string;
  comments: Thread[];
  responses: ResponseEntry[];
  rev: number;
  updatedAt: number | null;
  createdAt: number | null;
  lastAccessedAt: number | null;
  expiresAt: number | null;
  /** sha256 hex of the creator id, or null. Never send this to a client. */
  cid: string | null;
  tags: string[];
  creatorName: string | null;
  /** R2 prefix for this note's images, or null if it never had one. Never send to a client. */
  assetNs: string | null;
  assets: Record<string, StoredAsset>;
  /**
   * The revision a person last saw (a browser read or write, or an explicit mark), and when.
   * Null on notes no one has seen or changed since this was tracked; those never read as new.
   */
  seenRev: number | null;
  seenAt: number | null;
};

/**
 * Who is acting. A browser (session cookie, no explicit key) is a person: its reads and writes
 * mark the note seen. Anything with an explicit key is an agent: its writes leave the note new.
 */
export type Actor = "human" | "agent";

/** Changed since a person last saw it. Notes that predate tracking are never new. */
export function isUnseen(note: Pick<Note, "rev" | "seenRev">): boolean {
  return note.seenRev !== null && note.rev > note.seenRev;
}

/**
 * A requested change to a note's creator and tags. Ids are already hashed:
 * `target` is the new creator's cid, `proofs` every cid the caller holds.
 */
export type CreatorChange = {
  op: "" | "set" | "clear";
  target?: string;
  proofs: string[];
  /** Folder title for the resulting creator; empty leaves it unchanged. */
  name?: string;
  /** Replacement tags; undefined leaves them unchanged. */
  tags?: string[];
};

type CreatorDenied = { ok: false; reason: "forbidden" } | { ok: false; reason: "no_creator" };

export type WriteResult =
  | {
      ok: true;
      rev: number;
      updatedAt: number;
      expiresAt: number | null;
      size: number;
      hasCreator: boolean;
      tags: string[];
    }
  | { ok: false; reason: "conflict"; rev: number; content: string }
  | { ok: false; reason: "too_large"; size: number }
  | CreatorDenied;

export type MetaResult =
  | { ok: true; hasCreator: boolean; tags: string[]; creatorName: string | null }
  | { ok: false; reason: "not_found" }
  | CreatorDenied;

export type RenameResult =
  | { ok: true }
  | { ok: false; reason: "exists" }
  | { ok: false; reason: "not_found" };

/**
 * Note hash: `content`, `comments`, `responses`, `rev`, `updated_at`,
 * `created_at`, `last_accessed_at`, `title`, and — only for notes with a
 * creator — `cid`, `tags`, `meta_updated_at`; for notes with images,
 * `asset_ns` and `assets` (see assetIndex.ts).
 */
export const noteKey = (key: string) => `${storagePrefix()}note:${key}`;
/** Pre-metadata schema: a bare string. Read through to it, migrate on write. */
const legacyKey = (key: string) => `${storagePrefix()}content:${key}`;

/**
 * Creator index helpers shared by every script that can change a note's
 * membership. Index keys live under `{prefix}cidx:<cid>`:
 *   (zset) member = note key, score = updated_at
 *   :t:<tag> (set) note keys carrying the tag
 *   :tags (hash) tag -> count, field removed at zero
 *   :meta (hash) name, created_at, updated_at
 * Each script declares `local PREFIX` before this chunk. Index keys are
 * derived from note fields, so they cannot all be passed in KEYS.
 */
const CREATOR_LIB = `
local function cidx(c) return PREFIX .. 'cidx:' .. c end
local function note_hash(m) return PREFIX .. 'note:' .. m end
local function decode_tags(s)
  if not s or s == '' then return {} end
  local ok, v = pcall(cjson.decode, s)
  if ok and type(v) == 'table' then return v end
  return {}
end
local function untag(c, m, t)
  if redis.call('SREM', cidx(c) .. ':t:' .. t, m) == 1 then
    if redis.call('HINCRBY', cidx(c) .. ':tags', t, -1) <= 0 then redis.call('HDEL', cidx(c) .. ':tags', t) end
  end
end
local function addtag(c, m, t)
  if redis.call('SADD', cidx(c) .. ':t:' .. t, m) == 1 then redis.call('HINCRBY', cidx(c) .. ':tags', t, 1) end
end
local function unindex(c, m, tags)
  redis.call('ZREM', cidx(c), m)
  for _, t in ipairs(tags) do untag(c, m, t) end
end
-- Remove m from c's index. If the note no longer belongs to c (expired,
-- recreated, moved), its tags are unknown, so check every tag c uses.
local function drop(c, m, clear)
  local f = redis.call('HMGET', note_hash(m), 'cid', 'tags')
  local tags = f[1] == c and decode_tags(f[2]) or redis.call('HKEYS', cidx(c) .. ':tags')
  unindex(c, m, tags)
  if clear and f[1] == c then redis.call('HDEL', note_hash(m), 'cid', 'tags') end
end
-- Past the cap the least recently updated notes leave the index. The notes
-- themselves stay, detached from the creator so later writes don't re-add them.
local function evict(c)
  local over = redis.call('ZCARD', cidx(c)) - ${MAX_CREATOR_NOTES}
  if over <= 0 then return end
  for _, m in ipairs(redis.call('ZRANGE', cidx(c), 0, over - 1)) do drop(c, m, true) end
end
local function parse_proofs(s)
  local proofs = {}
  for p in string.gmatch(s, '%x+') do proofs[p] = true end
  return proofs
end
-- op: '' keeps the creator, 'set' assigns target, 'clear' removes it.
-- Leaving a creator needs proof of that creator; tag edits need proof of the
-- resulting creator. tags_arg is '' (unchanged) or a normalized JSON array.
local function creator_plan(h, op, target, proofs, tags_arg)
  local f = redis.call('HMGET', h, 'cid', 'tags')
  local cur = f[1]
  local plan = { cur = cur, final = cur, old = decode_tags(f[2]), tags_arg = tags_arg }
  if op == 'set' then
    if cur and cur ~= target and not proofs[cur] then return nil, 'forbidden' end
    plan.final = target
  elseif op == 'clear' then
    if cur and not proofs[cur] then return nil, 'forbidden' end
    plan.final = false
  end
  plan.new = plan.final and plan.old or {}
  if tags_arg ~= '' then
    if not plan.final then
      if tags_arg ~= '[]' then return nil, 'no_creator' end
    elseif not proofs[plan.final] then return nil, 'forbidden' end
    plan.new = decode_tags(tags_arg)
  end
  return plan
end
local function creator_apply(h, m, plan, score, now, name)
  local cur, final = plan.cur, plan.final
  local moved = cur ~= final
  if cur and moved then
    unindex(cur, m, plan.old)
    redis.call('HSET', cidx(cur) .. ':meta', 'updated_at', now)
  elseif cur and plan.tags_arg ~= '' then
    local keep = {}
    for _, t in ipairs(plan.new) do keep[t] = true end
    for _, t in ipairs(plan.old) do if not keep[t] then untag(cur, m, t) end end
  end
  if final then
    local added = redis.call('ZADD', cidx(final), score, m)
    if moved or plan.tags_arg ~= '' or name ~= '' then
      for _, t in ipairs(plan.new) do addtag(final, m, t) end
      local meta = cidx(final) .. ':meta'
      redis.call('HSETNX', meta, 'created_at', now)
      redis.call('HSET', meta, 'updated_at', now)
      if name ~= '' then redis.call('HSET', meta, 'name', name) end
      if moved then redis.call('HSET', h, 'cid', final) end
      if plan.tags_arg == '[]' then redis.call('HDEL', h, 'tags')
      elseif plan.tags_arg ~= '' then redis.call('HSET', h, 'tags', plan.tags_arg) end
      redis.call('HSET', h, 'meta_updated_at', now)
    end
    if added == 1 then evict(final) end
  elseif cur then
    redis.call('HDEL', h, 'cid', 'tags')
    redis.call('HSET', h, 'meta_updated_at', now)
  end
end
local function creator_result(h)
  local f = redis.call('HMGET', h, 'cid', 'tags')
  local name = f[1] and redis.call('HGET', cidx(f[1]) .. ':meta', 'name') or ''
  return f[1] and '1' or '0', f[2] or '[]', name or ''
end
`;

/**
 * KEYS: note hash, legacy string. ARGV: comments?, access?, now, prefix.
 * Returns [content, rev, updated_at, created_at, pttl, comments, responses,
 * last_accessed_at, cid, tags, creator_name, asset_ns, assets, seen_rev, seen_at] or nil.
 */
const READ_SCRIPT = `
local h, legacy = KEYS[1], KEYS[2]

if redis.call('EXISTS', h) == 1 then
  local f = redis.call('HMGET', h, 'content', 'rev', 'updated_at', 'created_at', 'last_accessed_at', 'cid', 'tags', 'asset_ns', 'assets', 'seen_rev', 'seen_at')
  local accessed = f[5] or ''
  if ARGV[2] == '1' and (accessed == '' or tonumber(ARGV[3]) - (tonumber(accessed) or 0) >= ${ACCESS_THROTTLE_MS}) then
    redis.call('HSET', h, 'last_accessed_at', ARGV[3])
    accessed = ARGV[3]
  end
  local name = f[6] and redis.call('HGET', ARGV[4] .. 'cidx:' .. f[6] .. ':meta', 'name') or ''
  return { f[1] or '', f[2] or '0', f[3] or '', f[4] or '', tostring(redis.call('PTTL', h)), ARGV[1] == '1' and (redis.call('HGET', h, 'comments') or '[]') or '[]', ARGV[1] == '1' and (redis.call('HGET', h, 'responses') or '[]') or '[]', accessed, f[6] or '', f[7] or '', name or '', f[8] or '', f[9] or '', f[10] or '', f[11] or '' }
end

local old = redis.call('GET', legacy)
if old then
  local pttl = redis.call('PTTL', legacy)
  if ARGV[2] == '1' then
    redis.call('HSET', h, 'content', old, 'rev', '0', 'updated_at', '', 'created_at', '', 'last_accessed_at', ARGV[3])
    if pttl >= 0 then redis.call('PEXPIRE', h, pttl) end
    redis.call('DEL', legacy)
    return { old, '0', '', '', tostring(pttl), '[]', '[]', ARGV[3], '', '', '', '', '', '', '' }
  end
  return { old, '0', '', '', tostring(pttl), '[]', '[]', '', '', '', '', '', '', '', '' }
end

return nil
`;

/**
 * All writes commit content + anchors under the snapshot revision. TTL stays
 * inside Lua, and so does creator index maintenance (ARGV 13–18) and image
 * reference tracking, which only runs for notes that have images.
 */
const COMMIT_SCRIPT = `
local PREFIX = ARGV[13]
${CREATOR_LIB}
${ASSET_LIB}
local h, legacy = KEYS[1], KEYS[2]
local exists = redis.call('EXISTS', h) == 1
local old = not exists and redis.call('GET', legacy) or false
local present = exists or old ~= false
local rev = tonumber(redis.call('HGET', h, 'rev')) or 0
local current = exists and (redis.call('HGET', h, 'content') or '') or old or ''
local comments = redis.call('HGET', h, 'comments') or '[]'
local responses = redis.call('HGET', h, 'responses') or '[]'
if ARGV[9] == '1' and not present then return {'missing'} end
if (ARGV[9] == '1') ~= present or rev ~= tonumber(ARGV[1]) or current ~= ARGV[2] or comments ~= ARGV[3] or responses ~= ARGV[4] then
  return {'conflict', tostring(rev), current}
end
if #ARGV[5] > tonumber(ARGV[11]) then return {'too_large', tostring(#ARGV[5])} end
local plan, denied = creator_plan(h, ARGV[14], ARGV[15], parse_proofs(ARGV[16]), ARGV[18])
if not plan then return {denied} end
local pttl = redis.call('PTTL', exists and h or legacy)
local created = redis.call('HGET', h, 'created_at') or ARGV[8]
redis.call('HSET', h, 'content', ARGV[5], 'comments', ARGV[6], 'responses', ARGV[7], 'rev', rev + 1, 'updated_at', ARGV[8], 'created_at', created, 'title', ARGV[12])
if ARGV[10] == '0' then redis.call('PERSIST', h)
elseif ARGV[10] ~= '' then redis.call('EXPIRE', h, tonumber(ARGV[10]))
elseif not exists and pttl >= 0 then redis.call('PEXPIRE', h, pttl) end
redis.call('DEL', legacy)
creator_apply(h, ARGV[19], plan, ARGV[8], ARGV[8], ARGV[17])
asset_refs(h, ARGV[19], ARGV[5], tonumber(ARGV[8]))
-- Seen tracking. A person's write is already seen. An agent's write is new: if no one has
-- seen this note yet, mark the revision before it as the last one seen so the change shows.
local folder = redis.call('HGET', h, 'cid')
if ARGV[20] == 'human' then
  redis.call('HSET', h, 'seen_rev', rev + 1, 'seen_at', ARGV[8])
  if folder then redis.call('SREM', cidx(folder) .. ':new', ARGV[19]) end
else
  if not redis.call('HGET', h, 'seen_rev') then redis.call('HSET', h, 'seen_rev', rev) end
  if folder then redis.call('SADD', cidx(folder) .. ':new', ARGV[19]) end
end
local has, tags = creator_result(h)
return {'ok', tostring(rev + 1), tostring(redis.call('PTTL', h)), tostring(#ARGV[5]), has, tags}
`;

/**
 * KEYS: note hash, legacy string. ARGV: prefix, note key, op, target, proofs,
 * name, tags, now. Metadata only: rev, content and updated_at are untouched.
 */
const META_SCRIPT = `
local PREFIX = ARGV[1]
${CREATOR_LIB}
local h, legacy = KEYS[1], KEYS[2]
if redis.call('EXISTS', h) == 0 then
  local old = redis.call('GET', legacy)
  if not old then return {'not_found'} end
  local pttl = redis.call('PTTL', legacy)
  redis.call('HSET', h, 'content', old, 'rev', '0', 'updated_at', '', 'created_at', '')
  if pttl >= 0 then redis.call('PEXPIRE', h, pttl) end
  redis.call('DEL', legacy)
end
local plan, denied = creator_plan(h, ARGV[3], ARGV[4], parse_proofs(ARGV[5]), ARGV[7])
if not plan then return {denied} end
local f = redis.call('HMGET', h, 'updated_at', 'created_at')
local score = tonumber(f[1]) or tonumber(f[2]) or tonumber(ARGV[8])
creator_apply(h, ARGV[2], plan, score, ARGV[8], ARGV[6])
local has, tags, name = creator_result(h)
return {'ok', has, tags, name}
`;

/**
 * KEYS: note hash, legacy string. ARGV: prefix, note key, now. Drops index
 * entries with the note. Returns [asset_ns, asset ids...] so the caller can
 * delete the objects; the sweep is queued to purge the prefix if that fails.
 */
const DELETE_SCRIPT = `
local PREFIX = ARGV[1]
${CREATOR_LIB}
${ASSET_LIB}
local f = redis.call('HMGET', KEYS[1], 'cid', 'tags', 'asset_ns', 'assets')
if f[1] then unindex(f[1], ARGV[2], decode_tags(f[2])) end
local out = { f[3] or '' }
if f[3] then
  for id in pairs(decode_assets(f[4]) or {}) do out[#out + 1] = id end
  local bytes = tonumber(redis.call('HGET', asset_key('nsbytes'), f[3])) or 0
  if bytes > 0 then redis.call('DECRBY', asset_key('bytes'), bytes) end
  redis.call('HDEL', asset_key('nsbytes'), f[3])
  redis.call('ZADD', asset_key('sweep'), ARGV[3], f[3] .. '|' .. ARGV[2])
end
redis.call('DEL', KEYS[1], KEYS[2])
return out
`;

/**
 * KEYS: old hash, old legacy, new hash, new legacy. ARGV: prefix, old key, new key.
 * Moves a note to a new key without rewriting content. RENAME keeps hash
 * fields, rev, and TTL. Destination must be free. Index members follow.
 */
const RENAME_SCRIPT = `
local PREFIX = ARGV[1]
${CREATOR_LIB}
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
  local f = redis.call('HMGET', newH, 'cid', 'tags')
  if f[1] then
    local z = cidx(f[1])
    local score = redis.call('ZSCORE', z, ARGV[2])
    if score then
      redis.call('ZREM', z, ARGV[2])
      redis.call('ZADD', z, score, ARGV[3])
    end
    for _, t in ipairs(decode_tags(f[2])) do
      if redis.call('SREM', z .. ':t:' .. t, ARGV[2]) == 1 then redis.call('SADD', z .. ':t:' .. t, ARGV[3]) end
    end
  end
  local ns = redis.call('HGET', newH, 'asset_ns')
  if ns then
    local sweep = PREFIX .. 'assets:sweep'
    local due = redis.call('ZSCORE', sweep, ns .. '|' .. ARGV[2])
    if due then
      redis.call('ZREM', sweep, ns .. '|' .. ARGV[2])
      redis.call('ZADD', sweep, due, ns .. '|' .. ARGV[3])
    end
  end
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

export function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const tags = JSON.parse(raw);
    return Array.isArray(tags) ? tags.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

const NO_CHANGE: CreatorChange = { op: "", proofs: [] };

/** ARGV tail shared by the commit and meta scripts: op, target, proofs, name, tags. */
function creatorArgs(change: CreatorChange): string[] {
  return [
    change.op,
    change.target ?? "",
    change.proofs.join(" "),
    change.name ?? "",
    change.tags === undefined ? "" : JSON.stringify(change.tags),
  ];
}

/** One field, one Redis command; legacy/missing notes both have revision zero. */
export async function readRevision(key: string): Promise<number> {
  return Number(await redis.hget(noteKey(key), "rev")) || 0;
}

export async function readNote(
  key: string,
  includeComments = false,
  recordAccess = false,
): Promise<Note | null> {
  const result = await redis.eval<string[], string[] | null>(
    READ_SCRIPT,
    [noteKey(key), legacyKey(key)],
    [includeComments ? "1" : "0", recordAccess ? "1" : "0", String(Date.now()), storagePrefix()],
  );

  if (!result) return null;

  const [content, rev, updatedAt, createdAt, pttl, comments, responses, lastAccessedAt, cid, tags, creatorName, assetNs, assets, seenRev, seenAt] = result;
  return {
    content,
    comments: JSON.parse(comments),
    responses: JSON.parse(responses),
    rev: Number(rev) || 0,
    updatedAt: toNumberOrNull(updatedAt),
    createdAt: toNumberOrNull(createdAt),
    lastAccessedAt: toNumberOrNull(lastAccessedAt),
    expiresAt: expiryFromPttl(Number(pttl), Date.now()),
    cid: cid || null,
    tags: cid ? parseTags(tags) : [],
    creatorName: cid ? creatorName || null : null,
    assetNs: assetNs || null,
    assets: parseAssets(assets),
    seenRev: toNumberOrNull(seenRev),
    seenAt: toNumberOrNull(seenAt),
  };
}

/** Count deliberate content reads and views without advancing the note revision. */
export function readAccessedNote(key: string, includeComments = false): Promise<Note | null> {
  return readNote(key, includeComments, true);
}

async function commitNote(
  key: string,
  before: Note | null,
  content: string,
  comments: Thread[],
  responses: ResponseEntry[],
  ttl?: number | null,
  creator: CreatorChange = NO_CHANGE,
  actor: Actor = "agent",
): Promise<WriteResult | { ok: false; reason: "missing" }> {
  const now = Date.now();
  const result = await redis.eval<string[], string[]>(
    COMMIT_SCRIPT,
    [noteKey(key), legacyKey(key)],
    [
      String(before?.rev ?? 0),
      before?.content ?? "",
      JSON.stringify(before?.comments ?? []),
      JSON.stringify(before?.responses ?? []),
      content,
      JSON.stringify(comments),
      JSON.stringify(responses),
      String(now),
      before ? "1" : "0",
      ttl === undefined ? "" : String(ttl ?? 0),
      String(MAX_CONTENT_BYTES),
      previewFromMarkdown(content)?.title ?? "",
      storagePrefix(),
      ...creatorArgs(creator),
      key,
      actor,
    ],
  );
  if (result[0] === "missing") return { ok: false, reason: "missing" };
  if (result[0] === "forbidden" || result[0] === "no_creator")
    return { ok: false, reason: result[0] };
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
    hasCreator: result[4] === "1",
    tags: result[4] === "1" ? parseTags(result[5]) : [],
  };
}

export async function writeNote(
  key: string,
  content: string,
  options: { mode?: WriteMode; ifRev?: number; ttl?: number | null; creator?: CreatorChange; actor?: Actor } = {},
): Promise<WriteResult> {
  const { mode = "overwrite", ifRev, ttl, creator, actor = "agent" } = options;
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
    const result = await commitNote(key, before, next, comments, before?.responses ?? [], ttl, creator, actor);
    if (result.ok || (result.reason !== "missing" && result.reason !== "conflict")) return result;
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
    [storagePrefix(), from, to],
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

/** Remove both the hash note and any legacy string for this key, and its index entries. */
export async function deleteNote(key: string): Promise<{ assetNs: string | null; assetIds: string[] }> {
  const [ns, ...ids] = await redis.eval<string[], string[]>(DELETE_SCRIPT, [noteKey(key), legacyKey(key)], [storagePrefix(), key, String(Date.now())]);
  return { assetNs: ns || null, assetIds: ids };
}

/** Change creator, name or tags without touching content, rev or updated_at. One EVAL. */
export async function updateNoteMeta(key: string, change: CreatorChange): Promise<MetaResult> {
  const result = await redis.eval<string[], string[]>(
    META_SCRIPT,
    [noteKey(key), legacyKey(key)],
    [storagePrefix(), key, ...creatorArgs(change), String(Date.now())],
  );
  if (result[0] === "not_found" || result[0] === "forbidden" || result[0] === "no_creator")
    return { ok: false, reason: result[0] };
  const hasCreator = result[1] === "1";
  return {
    ok: true,
    hasCreator,
    tags: hasCreator ? parseTags(result[2]) : [],
    creatorName: hasCreator ? result[3] || null : null,
  };
}

/** Operations and mapped anchors share the content commit; no separate anchor write. */
export async function commitComments(
  key: string,
  before: Note,
  content: string,
  comments: Thread[],
  actor: Actor = "agent",
): Promise<
  { status: "ok"; comments: Thread[] } | { status: "conflict" | "missing" }
> {
  const mapped = remapComments(before.content, content, comments);
  const result = await commitNote(key, before, content, mapped, before.responses, undefined, NO_CHANGE, actor);
  if (!result.ok)
    return { status: result.reason === "missing" ? "missing" : "conflict" };
  return { status: "ok", comments: mapped };
}

/** Responses use the same note hash, expiry, and revision as content/comments. */
export async function commitResponses(key: string, before: Note, responses: ResponseEntry[], actor: Actor = "agent") {
  const result = await commitNote(key, before, before.content, before.comments, responses, undefined, NO_CHANGE, actor);
  return result.ok ? { status: "ok" as const, rev: result.rev } : {
    status: result.reason === "missing" ? "missing" as const : "conflict" as const,
  };
}

/**
 * KEYS: note hash. ARGV: prefix, note key, now, rev ('' = current). Marks the note seen up to
 * that revision (never past the current one, never back from an earlier mark) and, when fully
 * seen, drops it from its folder's new set. Returns the seen revision, or nil for a missing
 * note. Never changes rev, updated_at or expiry.
 */
const SEEN_SCRIPT = `
local h = KEYS[1]
if redis.call('EXISTS', h) == 0 then return nil end
local f = redis.call('HMGET', h, 'rev', 'cid', 'seen_rev')
local current = tonumber(f[1]) or 0
local seen = ARGV[4] ~= '' and math.min(tonumber(ARGV[4]) or current, current) or current
if f[3] and (tonumber(f[3]) or 0) > seen then seen = tonumber(f[3]) end
redis.call('HSET', h, 'seen_rev', seen, 'seen_at', ARGV[3])
if f[2] and seen >= current then redis.call('SREM', ARGV[1] .. 'cidx:' .. f[2] .. ':new', ARGV[2]) end
return tostring(seen)
`;

/**
 * A person has seen the note (any client may say so; there are no accounts). Pass the revision
 * they actually saw so a change that lands in between still shows as new.
 */
export async function markSeen(key: string, options: { rev?: number; now?: number } = {}): Promise<{ rev: number; seenAt: number } | null> {
  const now = options.now ?? Date.now();
  const rev = await redis.eval<string[], string | null>(
    SEEN_SCRIPT,
    [noteKey(key)],
    [storagePrefix(), key, String(now), options.rev === undefined ? "" : String(Math.max(0, Math.floor(options.rev)))],
  );
  return rev === null ? null : { rev: Number(rev) || 0, seenAt: now };
}
