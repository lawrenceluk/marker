import type { Metadata } from "next";
import Link from "next/link";
import { CREATOR_SORTS, type CreatorListing, type CreatorSort } from "../lib/creators";
import { primaryButtonClass, secondaryButtonClass, textInputClass } from "../components/controlStyles";
import { folderTitle, readFolderPage, type SearchParams } from "./folderPage";

export async function generateMetadata({ searchParams }: { searchParams: Promise<SearchParams> }): Promise<Metadata> {
  const { result } = await readFolderPage(await searchParams);
  return { title: folderTitle(result?.status === "ok" ? result.listing : null) };
}

const SORT_LABELS: Record<CreatorSort, string> = { updated: "Updated", created: "Created", title: "Title" };

const ERRORS: Record<string, string> = {
  invalid: "That isn’t a valid creator id.",
  not_found: "No folder exists for that creator id.",
  limited: "Too many failed lookups. Try again in a few minutes.",
  missing_note: "That note is no longer in this folder.",
};

function href(tags: string[], sort: CreatorSort, cursor = 0) {
  const params = new URLSearchParams();
  for (const tag of tags) params.append("tag", tag);
  if (sort !== "updated") params.set("sort", sort);
  if (cursor) params.set("cursor", String(cursor));
  const query = params.toString();
  return query ? `/c?${query}` : "/c";
}

function formatDate(ms: number | null) {
  if (ms === null) return "—";
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export default async function CreatorFolder({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const { tags, sort, cursor, filterError, result } = await readFolderPage(params);

  let error = params.error ? ERRORS[params.error] ?? null : filterError;
  let listing: CreatorListing | null = null;
  if (result?.status === "ok") listing = result.listing;
  else if (result) error = ERRORS[result.status];

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-3xl px-4 py-12">
        <nav className="mb-8 flex items-center justify-between text-sm">
          <Link prefetch={false} href="/" className="text-zinc-600 hover:text-foreground dark:text-zinc-400">← Marker</Link>
          {listing && (
            <form method="post" action="/api/creator/session">
              <input type="hidden" name="forget" value="1" />
              <button type="submit" className="text-zinc-500 hover:text-foreground">Forget this folder</button>
            </form>
          )}
        </nav>

        {error && (
          <div role="alert" className="mb-6 rounded-lg bg-red-50 p-4 text-center text-red-600 dark:bg-red-900/20 dark:text-red-400">
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
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Open a folder</h1>
        <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
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
  const selected = new Set(tags);
  const toggle = (tag: string) => (selected.has(tag) ? tags.filter(t => t !== tag) : [...tags, tag].sort());

  return (
    <div className="flex flex-col gap-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{listing.creator_name ?? "Untitled folder"}</h1>
        <p className="text-sm text-zinc-500">
          {listing.total} {listing.total === 1 ? "note" : "notes"}{tags.length ? ` tagged ${tags.join(" + ")}` : ""}
        </p>
      </header>

      {(listing.tags.length > 0 || tags.length > 0) && (
        <div className="flex flex-wrap gap-2" aria-label="Filter by tags">
          {listing.tags.map(({ tag, count }) => (
            <Link prefetch={false}
              key={tag}
              href={href(toggle(tag), sort)}
              aria-pressed={selected.has(tag)}
              className={`creator-tag ${selected.has(tag) ? "creator-tag-on" : ""}`}
            >
              {tag} <span className="opacity-60">{count}</span>
            </Link>
          ))}
          {tags.length > 0 && <Link prefetch={false} href={href([], sort)} className="creator-tag">Clear</Link>}
        </div>
      )}

      <div className="flex items-center gap-1 text-sm" aria-label="Sort">
        <span className="mr-1 text-zinc-500">Sort</span>
        {CREATOR_SORTS.map(option => (
          <Link prefetch={false}
            key={option}
            href={href(tags, option)}
            aria-current={option === sort ? "true" : undefined}
            className={`rounded-md px-2 py-1 ${option === sort ? "bg-zinc-100 font-medium text-foreground dark:bg-zinc-800" : "text-zinc-500 hover:text-foreground"}`}
          >
            {SORT_LABELS[option]}
          </Link>
        ))}
      </div>

      {listing.notes.length === 0 ? (
        <p className="py-8 text-center text-sm text-zinc-500">No notes here yet.</p>
      ) : (
        <ul className="divide-y divide-hairline border-y border-hairline">
          {listing.notes.map(note => (
            <li key={note.ref}>
              <a href={`/c/open/${note.ref}`} className="flex flex-col gap-1 px-1 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900">
                <span className="font-medium text-foreground">{note.title || "Untitled note"}</span>
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
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
          {cursor > 0 ? <Link prefetch={false} href={href(tags, sort, 0)} className={`px-3 py-2 ${secondaryButtonClass}`}>First page</Link> : <span />}
          {listing.next_cursor !== null && (
            <Link prefetch={false} href={href(tags, sort, listing.next_cursor)} className={`px-3 py-2 ${secondaryButtonClass}`}>More</Link>
          )}
        </div>
      )}
    </div>
  );
}
