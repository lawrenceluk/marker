import { cache } from "react";
import { cookies, headers } from "next/headers";
import { CREATOR_COOKIE, normalizeCreatorId } from "../lib/creatorId";
import {
  CREATOR_SORTS,
  clientFingerprint,
  listCreatorNotes,
  parseTagFilter,
  type CreatorListing,
  type CreatorSort,
} from "../lib/creators";

export type SearchParams = { tag?: string | string[]; sort?: string; cursor?: string; error?: string };

export const GENERIC_FOLDER_TITLE = "Marker folder";

export function parseFolderParams(params: SearchParams) {
  const rawTags = params.tag === undefined ? [] : Array.isArray(params.tag) ? params.tag : [params.tag];
  const filter = parseTagFilter(rawTags);
  const tags = "error" in filter ? [] : filter.tags;
  const sort = CREATOR_SORTS.includes(params.sort as CreatorSort) ? (params.sort as CreatorSort) : "updated";
  const cursor = Math.max(0, Number(params.cursor) || 0);
  return { tags, sort, cursor, filterError: "error" in filter ? filter.error : null };
}

/**
 * Shared by metadata and the page body so a request runs the folder EVAL (and
 * its failed-lookup rate limit) once. Arguments are primitives because
 * `cache` compares them by identity.
 */
const listFolder = cache(async (id: string, client: string, tagsKey: string, sort: CreatorSort, cursor: number) =>
  listCreatorNotes(id, { tags: JSON.parse(tagsKey) as string[], sort, cursor, client }),
);

export async function readFolderPage(params: SearchParams) {
  const parsed = parseFolderParams(params);
  const id = normalizeCreatorId((await cookies()).get(CREATOR_COOKIE)?.value);
  const result = id
    ? await listFolder(id, clientFingerprint(await headers()), JSON.stringify(parsed.tags), parsed.sort, parsed.cursor)
    : null;
  return { ...parsed, result };
}

export function folderTitle(listing: CreatorListing | null): string {
  if (!listing) return GENERIC_FOLDER_TITLE;
  return `${listing.creator_name ?? "Untitled folder"} · Marker`;
}
