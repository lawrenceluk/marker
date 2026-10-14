import { redis } from "./redis";
import { storagePrefix } from "./namespace";
import {
  CREATOR_COOKIE,
  creatorCookieOptions,
  normalizeCreatorId,
} from "./creatorId";
import {
  LOOKUP_FAILURE_LIMIT,
  LOOKUP_WINDOW_SECONDS,
  creatorHash,
  folderRef,
  rateLimitKey,
} from "./creators";

/**
 * Folders this browser has opened, newest first, for the home page. The
 * cookie is httpOnly and holds raw creator ids, so they never reach page
 * HTML; pages only see `folderRef` handles. Ids are added only after the
 * server has confirmed the creator exists.
 */
export const FOLDERS_COOKIE = "marker_folders";
export const MAX_REMEMBERED_FOLDERS = 10;

export type RememberedFolder = { id: string; visitedAt: number };

export type FolderSummary = {
  ref: string;
  /** Null when the lookup was refused (rate limit) or the folder has no name. */
  name: string | null;
  /** Indexed notes, including expired ones not yet pruned. Null when refused. */
  count: number | null;
  /** Notes changed since a person last saw them. 0 when refused. */
  unseen: number;
  visited_at: number;
};

type CookieSource = { get(name: string): { value: string } | undefined };
type CookieSetter = {
  set(name: string, value: string, options: ReturnType<typeof creatorCookieOptions>): void;
};

export function readRememberedFolders(cookies: CookieSource): RememberedFolder[] {
  const raw = cookies.get(FOLDERS_COOKIE)?.value;
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  const folders: RememberedFolder[] = [];
  for (const entry of parsed) {
    if (!Array.isArray(entry)) continue;
    const id = normalizeCreatorId(entry[0]);
    const visitedAt = Number(entry[1]);
    if (!id || seen.has(id) || !Number.isFinite(visitedAt)) continue;
    seen.add(id);
    folders.push({ id, visitedAt });
  }
  return folders.sort((a, b) => b.visitedAt - a.visitedAt).slice(0, MAX_REMEMBERED_FOLDERS);
}

export function writeRememberedFolders(cookies: CookieSetter, folders: RememberedFolder[]) {
  if (!folders.length) {
    cookies.set(FOLDERS_COOKIE, "", creatorCookieOptions(0));
    return;
  }
  const value = Buffer.from(
    JSON.stringify(folders.slice(0, MAX_REMEMBERED_FOLDERS).map(f => [f.id, f.visitedAt])),
  ).toString("base64url");
  cookies.set(FOLDERS_COOKIE, value, creatorCookieOptions());
}

/** Move (or add) a folder to the front of the list. */
export function rememberFolder(folders: RememberedFolder[], id: string, now = Date.now()): RememberedFolder[] {
  return [{ id, visitedAt: now }, ...folders.filter(f => f.id !== id)].slice(0, MAX_REMEMBERED_FOLDERS);
}

export function findFolderByRef(folders: RememberedFolder[], ref: string): RememberedFolder | null {
  return folders.find(f => folderRef(creatorHash(f.id)) === ref) ?? null;
}

/** A note key alone grants no folder access. Only link credentials this browser already holds. */
export function noteFolderHref(cid: string | null, cookies: CookieSource): string | null {
  if (!cid) return null;
  const active = normalizeCreatorId(cookies.get(CREATOR_COOKIE)?.value);
  if (active && creatorHash(active) === cid) return "/c";
  const remembered = readRememberedFolders(cookies).find(folder => creatorHash(folder.id) === cid);
  return remembered ? `/c/folder/${folderRef(cid)}` : null;
}

/** Make `id` the active folder and the most recent remembered one. */
export function activateFolder(request: CookieSource, response: CookieSetter, id: string) {
  response.set(CREATOR_COOKIE, id, creatorCookieOptions());
  writeRememberedFolders(response, rememberFolder(readRememberedFolders(request), id));
}

/** Forget a remembered folder; also drops it as the active folder. */
export function forgetFolder(request: CookieSource, response: CookieSetter, id: string) {
  writeRememberedFolders(response, readRememberedFolders(request).filter(f => f.id !== id));
  if (normalizeCreatorId(request.get(CREATOR_COOKIE)?.value) === id) {
    response.set(CREATOR_COOKIE, "", creatorCookieOptions(0));
  }
}

/**
 * ARGV: prefix, rate-limit key, cid... Returns name and index size for each
 * creator that exists. A cookie can be forged, so misses count toward the
 * same wrong-id limit as the folder gate.
 */
const SUMMARY_SCRIPT = `
local prefix, rl = ARGV[1], ARGV[2]
if (tonumber(redis.call('GET', rl)) or 0) >= ${LOOKUP_FAILURE_LIMIT} then return {'limited'} end
local out, misses = {'ok'}, 0
for i = 3, #ARGV do
  local base = prefix .. 'cidx:' .. ARGV[i]
  local name = redis.call('HGET', base .. ':meta', 'name')
  if name or redis.call('EXISTS', base .. ':meta') == 1 then
    -- Notes changed since a person saw them. The set is kept on write and checked here, so
    -- notes that were seen, moved, expired or deleted since drop out.
    local fresh = 0
    for _, m in ipairs(redis.call('SMEMBERS', base .. ':new')) do
      local f = redis.call('HMGET', prefix .. 'note:' .. m, 'cid', 'rev', 'seen_rev')
      if f[1] == ARGV[i] and f[3] and (tonumber(f[2]) or 0) > (tonumber(f[3]) or 0) then fresh = fresh + 1
      else redis.call('SREM', base .. ':new', m) end
    end
    out[#out + 1] = { ARGV[i], name or '', tostring(redis.call('ZCARD', base)), tostring(fresh) }
  else
    misses = misses + 1
  end
end
if misses > 0 and redis.call('INCRBY', rl, misses) == misses then redis.call('EXPIRE', rl, ${LOOKUP_WINDOW_SECONDS}) end
return out
`;

/** Names and counts for the home page: one EVAL for the whole list, none when it is empty. */
export async function summarizeFolders(folders: RememberedFolder[], client: string): Promise<FolderSummary[]> {
  if (!folders.length) return [];
  const cids = folders.map(f => creatorHash(f.id));
  const result = await redis.eval<string[], unknown[]>(
    SUMMARY_SCRIPT,
    [],
    [storagePrefix(), rateLimitKey(client), ...cids],
  );
  const found = new Map<string, { name: string | null; count: number | null; unseen: number }>();
  if (result[0] === "limited") {
    for (const cid of cids) found.set(cid, { name: null, count: null, unseen: 0 });
  } else {
    for (const row of result.slice(1) as string[][]) {
      found.set(String(row[0]), { name: String(row[1]) || null, count: Number(row[2]) || 0, unseen: Number(row[3]) || 0 });
    }
  }
  return folders.flatMap((folder, i) => {
    const info = found.get(cids[i]!);
    return info ? [{ ref: folderRef(cids[i]!), ...info, visited_at: folder.visitedAt }] : [];
  });
}
