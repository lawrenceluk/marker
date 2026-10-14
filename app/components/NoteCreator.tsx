"use client";

import { useId, useState } from "react";
import { normalizeTags } from "../lib/creatorId";
import type { FrontMatter } from "../lib/frontmatter";
import { summarizeMetadata } from "../lib/metadataSummary";
import { primaryButtonClass, secondaryButtonClass, textInputClass } from "./controlStyles";

export type NoteCreatorInfo = {
  hasCreator: boolean;
  name: string | null;
  tags: string[];
  /** The viewer's folder cookie matches this note's creator. */
  linked: boolean;
};

/** Read the creator fields off a `GET /api/content` response. */
export function creatorFromResponse(data: {
  has_creator?: boolean;
  creator_name?: string | null;
  tags?: string[];
  creator_linked?: boolean;
}): NoteCreatorInfo {
  return {
    hasCreator: Boolean(data.has_creator),
    name: data.creator_name ?? null,
    tags: data.tags ?? [],
    linked: Boolean(data.creator_linked),
  };
}

function folderHref(tag?: string) {
  return tag ? `/c?tag=${encodeURIComponent(tag)}` : "/c";
}

/**
 * The note's byline (Figma Note "byline", BylineMetadata): its folder and tags, then its front
 * matter. The first few short values read inline; anything more opens below as a key/value list.
 */
export function NoteCreator({
  info,
  metadata = null,
  editing,
  isSaving,
  onSave,
  onCancel,
}: {
  info: NoteCreatorInfo | null;
  metadata?: FrontMatter | null;
  editing: boolean;
  isSaving: boolean;
  onSave: (tags: string[]) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(info?.tags.join(", ") ?? "");
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const listId = useId();

  if (editing && info?.hasCreator) {
    return (
      <form
        className="mb-4 flex flex-col gap-2"
        onSubmit={event => {
          event.preventDefault();
          const result = normalizeTags(draft.split(/[,\s]+/).filter(Boolean));
          if ("error" in result) {
            setError(result.error);
            return;
          }
          setError(null);
          onSave(result.tags);
        }}
      >
        <div className="flex items-center gap-3">
          <input
            autoFocus
            value={draft}
            onChange={event => setDraft(event.target.value)}
            aria-label="Tags"
            placeholder="plans, q4"
            className={`min-w-0 flex-1 ${textInputClass()}`}
          />
          <button type="submit" disabled={isSaving} className={primaryButtonClass()}>{isSaving ? "Saving…" : "Save"}</button>
          <button type="button" onClick={onCancel} className={secondaryButtonClass()}>Cancel</button>
        </div>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </form>
    );
  }

  const folder = info?.hasCreator && (info.name || info.tags.length) ? info : null;
  const summary = metadata?.fields ? summarizeMetadata(metadata.fields) : null;
  const malformed = metadata !== null && metadata.fields === null;
  const more = malformed || (summary !== null && summary.more > 0);
  if (!folder && !summary?.entries.length && !malformed) return null;
  const toggle = malformed ? "metadata" : !summary ? "" : summary.inline.length ? `${summary.more} more` : `${summary.more} ${summary.more === 1 ? "field" : "fields"}`;
  return (
    <div className="byline-block">
      <div className="note-creator">
        {folder && <span className="contents" aria-label="Folder">
          {folder.name && (folder.linked
            ? <a href={folderHref()} className="byline-folder">{folder.name}</a>
            : <span className="byline-folder">{folder.name}</span>)}
          {folder.tags.map(tag => folder.linked
            ? <a key={tag} href={folderHref(tag)} className="tag tag-small">{tag}</a>
            : <span key={tag} className="tag tag-small">{tag}</span>)}
        </span>}
        {summary && summary.inline.length > 0 && <span className="byline-values">{summary.inline.join(" · ")}</span>}
        {more && <button type="button" className="byline-more" aria-expanded={open} aria-controls={listId} onClick={() => setOpen(value => !value)}>{open ? "less" : toggle}</button>}
      </div>
      {more && open && (malformed
        ? <div id={listId} className="metadata-list"><p>Couldn’t format this metadata. Original YAML:</p><pre>{metadata!.raw}</pre></div>
        : <dl id={listId} className="metadata-list">{summary!.entries.map(({ key, value }, index) => <div key={index} className="metadata-row"><dt>{key}</dt><dd>{value}</dd></div>)}</dl>)}
    </div>
  );
}
