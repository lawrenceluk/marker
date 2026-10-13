import type { Metadata } from "next";
import Link from "next/link";
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
import { folderHref } from "../lib/folderHref";
import { FolderNav } from "../components/FolderNav";
import { FolderTagChips } from "../components/FolderTagChips";
import { primaryButtonClass, secondaryButtonClass, textInputClass } from "../components/controlStyles";

export const metadata: Metadata = { title: "Marker folder" };

type SearchParams = { tag?: string | string[]; sort?: string; cursor?: string; error?: string };

const SORT_LABELS: Record<CreatorSort, string> = { updated: "Updated", created: "Created", title: "Title" };

const ERRORS: Record<string, string> = {
  invalid: "That isn’t a valid creator id.",
  not_found: "No folder exists for that creator id.",
  limited: "Too many failed lookups. Try again in a few minutes.",
  missing_note: "That note is no longer in this folder.",
};

function formatDate(ms: number | null) {
  if (ms === null) return "—";
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export default async function CreatorFolder({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const id = normalizeCreatorId((await cookies()).get(CREATOR_COOKIE)?.value);
  const rawTags = params.tag === undefined ? [] : Array.isArray(params.tag) ? params.tag : [params.tag];
  const filter = parseTagFilter(rawTags);
  const tags = "error" in filter ? [] : filter.tags;
  const sort = CREATOR_SORTS.includes(params.sort as CreatorSort) ? (params.sort as CreatorSort) : "updated";
  const cursor = Math.max(0, Number(params.cursor) || 0);

  let error = params.error ? ERRORS[params.error] ?? null : "error" in filter ? filter.error : null;
  let listing: CreatorListing | null = null;
  if (id) {
    const result = await listCreatorNotes(id, { tags, sort, cursor, client: clientFingerprint(await headers()) });
    if (result.status === "ok") listing = result.listing;
    else error = ERRORS[result.status];
  }

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-3xl px-4 py-12">
        <FolderNav canForget={listing !== null} />

        {error && (
          <div role="alert" className="mb-6 rounded-lg bg-danger-surface p-4 text-center text-danger">
            {error}
          </div>
        )}

        {listing ? <Folder listing={listing} tags={tags} sort={sort} cursor={cursor} /> : <PasteId />}
      </main>
    </div>
  );
}

function PasteId() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-bold text-foreground">Open a folder</h1>
        <p className="text-sm leading-relaxed text-muted">
          Paste the creator id your agent gave you. It is a secret: anyone holding it can see this
          folder and open every note in it.
        </p>
      </div>
      <form method="post" action="/api/creator/session" className="flex gap-2">
        <input
          name="creator_id"
          type="password"
          autoComplete="off"
          spellCheck={false}
          required
          aria-label="Creator id"
          placeholder="Creator id"
          className={`min-w-0 flex-1 px-4 py-3 ${textInputClass}`}
        />
        <button type="submit" className={`px-5 py-3 ${primaryButtonClass}`}>Open</button>
      </form>
    </div>
  );
}

function Folder({ listing, tags, sort, cursor }: { listing: CreatorListing; tags: string[]; sort: CreatorSort; cursor: number }) {
  return (
    <div className="flex flex-col gap-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-foreground">{listing.creator_name ?? "Untitled folder"}</h1>
        <p className="text-sm text-muted">
          {listing.total} {listing.total === 1 ? "note" : "notes"}{tags.length ? ` tagged ${tags.join(" + ")}` : ""}
        </p>
      </header>

      {(listing.tags.length > 0 || tags.length > 0) && (
        <FolderTagChips tags={listing.tags} selected={tags} sort={sort} />
      )}

      <div className="flex items-center gap-1 text-sm" aria-label="Sort">
        <span className="mr-1 text-muted">Sort</span>
        {CREATOR_SORTS.map(option => (
          <Link prefetch={false}
            key={option}
            href={folderHref(tags, option)}
            aria-current={option === sort ? "true" : undefined}
            className={`rounded-md px-2 py-1 ${option === sort ? "bg-code-background font-medium text-foreground" : "text-muted hover:text-foreground"}`}
          >
            {SORT_LABELS[option]}
          </Link>
        ))}
      </div>

      {listing.notes.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">No notes here yet.</p>
      ) : (
        <ul className="divide-y divide-hairline border-y border-hairline">
          {listing.notes.map(note => (
            <li key={note.ref}>
              <a href={`/c/open/${note.ref}`} className="flex flex-col gap-1 px-1 py-3 hover:bg-code-background">
                <span className="font-medium text-foreground">{note.title || "Untitled note"}</span>
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                  <span>{sort === "created" ? `Created ${formatDate(note.created_at)}` : `Updated ${formatDate(note.updated_at)}`}</span>
                  {note.expires_at !== null && <span>Expires {formatDate(note.expires_at)}</span>}
                  {note.tags.map(tag => <span key={tag} className="creator-tag creator-tag-small">{tag}</span>)}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}

      {(cursor > 0 || listing.next_cursor !== null) && (
        <div className="flex justify-between text-sm">
          {cursor > 0 ? <Link prefetch={false} href={folderHref(tags, sort, 0)} className={`px-3 py-2 ${secondaryButtonClass}`}>First page</Link> : <span />}
          {listing.next_cursor !== null && (
            <Link prefetch={false} href={folderHref(tags, sort, listing.next_cursor)} className={`px-3 py-2 ${secondaryButtonClass}`}>More</Link>
          )}
        </div>
      )}
    </div>
  );
}
