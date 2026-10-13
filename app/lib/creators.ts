import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { redis } from "./redis";
import { storagePrefix } from "./namespace";
import { previewFromMarkdown } from "./preview";
import { parseTags, type CreatorChange } from "./notes";
import {
  CREATOR_COOKIE,
  generateCreatorId,
  normalizeCreatorId,
  normalizeCreatorName,
  normalizeTag,
  normalizeTags,
} from "./creatorId";

export const CREATOR_PAGE_SIZE = 50;
export const CREATOR_SORTS = ["updated", "created", "title"] as const;
export type CreatorSort = (typeof CREATOR_SORTS)[number];

/** Failed creator lookups allowed per client before lookups are refused for the window. */
export const LOOKUP_FAILURE_LIMIT = 30;
export const LOOKUP_WINDOW_SECONDS = 15 * 60;

/** Only this hash is stored or used in Redis keys; the raw id never is. */
export function creatorHash(id: string): string {
  return createHash("sha256").update(id).digest("hex");
}

type HeaderSource = { get(name: string): string | null };
type CookieSource = { get(name: string): { value: string } | undefined };

export function bearerCreatorId(headers: HeaderSource): string | null {
  const match = /^Bearer\s+(.+)$/i.exec(headers.get("authorization") ?? "");
  return match ? normalizeCreatorId(match[1]) : null;
}

/** Explicit bearer header first (agents), then the browser's folder cookie. */
export function requestCreatorId(request: { headers: HeaderSource; cookies: CookieSource }): string | null {
  return bearerCreatorId(request.headers) ?? normalizeCreatorId(request.cookies.get(CREATOR_COOKIE)?.value);
}

/** Coarse per-client bucket for the wrong-id rate limit. Stored hashed. */
export function clientFingerprint(headers: HeaderSource): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "unknown";
}

export function rateLimitKey(client: string) {
  return `${storagePrefix()}crl:${createHash("sha256").update(client).digest("hex").slice(0, 32)}`;
}

function refSecret(): string {
  return process.env.MARKER_REF_SECRET || process.env.KV_REST_API_TOKEN || "marker-ref";
}

/** Opaque, creator-bound handle for a listed note. Raw note keys never reach the folder HTML. */
export function noteRef(cid: string, key: string): string {
  return createHmac("sha256", refSecret()).update(`${cid}\n${key}`).digest("base64url").slice(0, 22);
}

/** Opaque handle for a remembered folder on the home page. */
export function folderRef(cid: string): string {
  return createHmac("sha256", refSecret()).update(`folder\n${cid}`).digest("base64url").slice(0, 22);
}

export const CREATOR_FORBIDDEN =
  "This change needs the id of the creator the note belongs to: pass it as creator_id (same creator), previous_creator_id (moving or removing), or Authorization: Bearer.";
export const CREATOR_REQUIRED = "Tags require the note to have a creator; pass creator_id";

export type CreatorParams =
  | { ok: true; change: CreatorChange; generatedId: string | null; touchesCreator: boolean }
  | { ok: false; error: string };

/**
 * Validate `creator_id`, `previous_creator_id`, `creator_name` and `tags`
 * from a request body. Proofs are every creator id the caller demonstrably
 * holds; the Lua scripts decide which one an operation needs.
 */
export function parseCreatorParams(
  body: Record<string, unknown>,
  request: { headers: HeaderSource; cookies: CookieSource },
): CreatorParams {
  const proofs = new Set<string>();
  const change: CreatorChange = { op: "", proofs: [] };
  let generatedId: string | null = null;

  if (body.previous_creator_id !== undefined) {
    const previous = normalizeCreatorId(body.previous_creator_id);
    if (!previous) return { ok: false, error: "previous_creator_id is not a valid creator id" };
    proofs.add(creatorHash(previous));
  }
  const ambient = requestCreatorId(request);
  if (ambient) proofs.add(creatorHash(ambient));

  if (body.creator_id === null) {
    change.op = "clear";
  } else if (body.creator_id === true || body.creator_id === "new") {
    generatedId = generateCreatorId();
    change.op = "set";
    change.target = creatorHash(generatedId);
  } else if (body.creator_id !== undefined) {
    const id = normalizeCreatorId(body.creator_id);
    if (!id) {
      return {
        ok: false,
        error: "creator_id must be 22–128 characters of A-Z, a-z, 0-9, \"_\", \"-\" or \"~\"; true to generate one; or null to remove the creator",
      };
    }
    change.op = "set";
    change.target = creatorHash(id);
  }
  if (change.target) proofs.add(change.target);

  if (body.creator_name !== undefined) {
    if (change.op !== "set") return { ok: false, error: "creator_name requires creator_id" };
    const name = normalizeCreatorName(body.creator_name);
    if (!name) return { ok: false, error: "creator_name must be 1–80 characters with no control characters" };
    change.name = name;
  }

  if (body.tags !== undefined) {
    const tags = normalizeTags(body.tags);
    if ("error" in tags) return { ok: false, error: tags.error };
    if (change.op === "clear" && tags.tags.length) {
      return { ok: false, error: "Removing the creator also removes tags; tags must be omitted, null or []" };
    }
    change.tags = tags.tags;
  }

  change.proofs = [...proofs];
  return {
    ok: true,
    change,
    generatedId,
    touchesCreator: change.op !== "" || change.tags !== undefined,
  };
}

/** Parse repeated `?tag=` values. Invalid filters are a 400, never ignored. */
export function parseTagFilter(values: string[]): { tags: string[] } | { error: string } {
  const tags = new Set<string>();
  for (const value of values) {
    const tag = normalizeTag(value);
    if (!tag) return { error: `Invalid tag ${JSON.stringify(value)}` };
    tags.add(tag);
  }
  if (tags.size > 10) return { error: "Filter by at most 10 tags" };
  return { tags: [...tags].sort() };
}

/**
 * Shared gate: refuse once a client has too many recent misses, and count a
 * miss when the creator has no meta hash. One GET plus, on a miss, INCR/EXPIRE.
 */
const GATE_LUA = `
local fails = tonumber(redis.call('GET', ARGV[3])) or 0
if fails >= ${LOOKUP_FAILURE_LIMIT} then return {'limited'} end
if redis.call('EXISTS', cidx(ARGV[2]) .. ':meta') == 0 then
  if redis.call('INCR', ARGV[3]) == 1 then redis.call('EXPIRE', ARGV[3], ${LOOKUP_WINDOW_SECONDS}) end
  return {'not_found'}
end
`;

const LIST_LIB = `
local PREFIX = ARGV[1]
local function cidx(c) return PREFIX .. 'cidx:' .. c end
local function note_hash(m) return PREFIX .. 'note:' .. m end
`;

/** ARGV: prefix, cid, rate-limit key. */
const GATE_SCRIPT = `${LIST_LIB}${GATE_LUA}
return {'ok'}
`;

/** ARGV: prefix, cid, rate-limit key. Returns every indexed note key for ref resolution. */
const MEMBERS_SCRIPT = `${LIST_LIB}${GATE_LUA}
return {'ok', redis.call('ZRANGE', cidx(ARGV[2]), 0, -1)}
`;

/**
 * ARGV: prefix, cid, rate-limit key, tag filter JSON, sort, offset, page size.
 * One EVAL per page: gate, select (ZREVRANGE or tag-set intersection), read
 * each row, lazily prune notes that expired or left the creator, and return
 * the folder name and tag counts.
 */
const LIST_SCRIPT = `${LIST_LIB}${GATE_LUA}
local c = ARGV[2]
local z = cidx(c)
local counts = z .. ':tags'
local function untag(m, t)
  if redis.call('SREM', z .. ':t:' .. t, m) == 1 then
    if redis.call('HINCRBY', counts, t, -1) <= 0 then redis.call('HDEL', counts, t) end
  end
end
local function prune(m)
  redis.call('ZREM', z, m)
  for _, t in ipairs(redis.call('HKEYS', counts)) do untag(m, t) end
end
local function load(m)
  local f = redis.call('HMGET', note_hash(m), 'cid', 'title', 'tags', 'updated_at', 'created_at', 'rev', 'seen_rev')
  if f[1] ~= c then prune(m) return nil end
  -- [8]: changed since a person last saw it (notes that predate tracking have no seen_rev and are not new).
  local unseen = f[7] and (tonumber(f[6]) or 0) > (tonumber(f[7]) or 0) and '1' or '0'
  return { m, f[2] and '1' or '0', f[2] or '', f[3] or '[]', f[4] or '', f[5] or '', '', unseen }
end
local function finish(r)
  if r[2] == '0' then r[3] = string.sub(redis.call('HGET', note_hash(r[1]), 'content') or '', 1, 4000) end
  r[7] = tostring(redis.call('PTTL', note_hash(r[1])))
  return r
end

local filter = cjson.decode(ARGV[4])
local sort, offset, size = ARGV[5], tonumber(ARGV[6]), tonumber(ARGV[7])
local rows, total, nextc = {}, 0, -1

if #filter == 0 and sort == 'updated' then
  local count = redis.call('ZCARD', z)
  local pruned = 0
  for _, m in ipairs(redis.call('ZREVRANGE', z, offset, offset + size - 1)) do
    local r = load(m)
    if r then rows[#rows + 1] = finish(r) else pruned = pruned + 1 end
  end
  total = count - pruned
  if offset + size < count then nextc = offset + size - pruned end
else
  local members
  if #filter == 0 then
    members = redis.call('ZRANGE', z, 0, -1)
  else
    local keys = {}
    for i, t in ipairs(filter) do keys[i] = z .. ':t:' .. t end
    members = redis.call('SINTER', unpack(keys))
  end
  local all = {}
  for _, m in ipairs(members) do
    local r = load(m)
    if r then all[#all + 1] = r end
  end
  local function num(v) return tonumber(v) or 0 end
  table.sort(all, function(a, b)
    if sort == 'title' then
      local ta, tb = string.lower(a[3]), string.lower(b[3])
      if ta ~= tb then return ta < tb end
    elseif sort == 'created' then
      if num(a[6]) ~= num(b[6]) then return num(a[6]) > num(b[6]) end
    end
    if num(a[5]) ~= num(b[5]) then return num(a[5]) > num(b[5]) end
    return a[1] < b[1]
  end)
  total = #all
  for i = offset + 1, math.min(offset + size, total) do rows[#rows + 1] = finish(all[i]) end
  if offset + size < total then nextc = offset + size end
end

local meta = redis.call('HMGET', z .. ':meta', 'name', 'created_at')
return {'ok', meta[1] or '', meta[2] or '', redis.call('HGETALL', counts), tostring(total), tostring(nextc), rows}
`;

export type GateStatus = "ok" | "not_found" | "limited";

/** Does this creator exist? Counts a miss toward the client's rate limit. One EVAL. */
export async function checkCreator(creatorId: string, client: string): Promise<GateStatus> {
  const [status] = await redis.eval<string[], string[]>(
    GATE_SCRIPT,
    [],
    [storagePrefix(), creatorHash(creatorId), rateLimitKey(client)],
  );
  return status as GateStatus;
}

export type CreatorNoteRow = {
  ref: string;
  title: string;
  tags: string[];
  updated_at: number | null;
  created_at: number | null;
  expires_at: number | null;
  /** Changed since a person last saw it. */
  unseen: boolean;
};

export type CreatorListing = {
  creator_name: string | null;
  created_at: number | null;
  tags: { tag: string; count: number }[];
  notes: CreatorNoteRow[];
  total: number;
  next_cursor: number | null;
};

function num(value: unknown): number | null {
  const n = Number(value);
  return value !== "" && value !== null && Number.isFinite(n) ? n : null;
}

/** One page of a creator's folder. Exactly one EVAL. */
export async function listCreatorNotes(
  creatorId: string,
  options: { tags?: string[]; sort?: CreatorSort; cursor?: number; client: string },
): Promise<{ status: "ok"; listing: CreatorListing } | { status: "not_found" } | { status: "limited" }> {
  const cid = creatorHash(creatorId);
  const result = await redis.eval<string[], unknown[]>(
    LIST_SCRIPT,
    [],
    [
      storagePrefix(),
      cid,
      rateLimitKey(options.client),
      JSON.stringify(options.tags ?? []),
      options.sort ?? "updated",
      String(Math.max(0, Math.floor(options.cursor ?? 0))),
      String(CREATOR_PAGE_SIZE),
    ],
  );
  if (result[0] !== "ok") return { status: result[0] === "limited" ? "limited" : "not_found" };

  const [, name, createdAt, flatCounts, total, nextCursor, rows] = result as [
    string, string, string, string[], string, string, string[][],
  ];
  const tags: { tag: string; count: number }[] = [];
  for (let i = 0; i + 1 < (flatCounts ?? []).length; i += 2) {
    const count = Number(flatCounts[i + 1]);
    if (count > 0) tags.push({ tag: String(flatCounts[i]), count });
  }
  tags.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));

  const now = Date.now();
  const notes = (rows ?? []).map(([key, hasTitle, title, rowTags, updated, created, pttl, unseen]) => {
    const resolved = hasTitle === "1" ? String(title) : previewFromMarkdown(String(title))?.title ?? "";
    const ttl = Number(pttl);
    return {
      ref: noteRef(cid, String(key)),
      title: resolved,
      tags: parseTags(String(rowTags)),
      updated_at: num(updated),
      created_at: num(created),
      expires_at: ttl >= 0 ? now + ttl : null,
      unseen: unseen === "1",
    };
  });

  const next = Number(nextCursor);
  return {
    status: "ok",
    listing: {
      creator_name: name || null,
      created_at: num(createdAt),
      tags,
      notes,
      total: Number(total) || 0,
      next_cursor: next >= 0 ? next : null,
    },
  };
}

/** Map a folder row's ref back to its note key, server-side. One EVAL. */
export async function resolveNoteRef(
  creatorId: string,
  ref: string,
  client: string,
): Promise<{ status: "ok"; key: string } | { status: "not_found" } | { status: "limited" }> {
  const cid = creatorHash(creatorId);
  const result = await redis.eval<string[], unknown[]>(
    MEMBERS_SCRIPT,
    [],
    [storagePrefix(), cid, rateLimitKey(client)],
  );
  if (result[0] !== "ok") return { status: result[0] === "limited" ? "limited" : "not_found" };
  const wanted = Buffer.from(ref);
  for (const member of (result[1] as string[]) ?? []) {
    const candidate = Buffer.from(noteRef(cid, String(member)));
    if (candidate.length === wanted.length && timingSafeEqual(candidate, wanted)) {
      return { status: "ok", key: String(member) };
    }
  }
  return { status: "not_found" };
}
