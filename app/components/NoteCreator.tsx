"use client";

import { useState } from "react";
import { normalizeTags } from "../lib/creatorId";
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

export function NoteCreator({
  info,
  editing,
  isSaving,
  onSave,
  onCancel,
}: {
  info: NoteCreatorInfo;
  editing: boolean;
  isSaving: boolean;
  onSave: (tags: string[]) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(info.tags.join(", "));
  const [error, setError] = useState<string | null>(null);
  if (!info.hasCreator) return null;

  if (editing) {
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
        <label className="text-sm text-muted" htmlFor="note-tags">Tags, separated by commas</label>
        <div className="flex gap-2">
          <input
            id="note-tags"
            autoFocus
            value={draft}
            onChange={event => setDraft(event.target.value)}
            placeholder="plans, q4"
            className={`min-w-0 flex-1 px-3 py-2 text-sm ${textInputClass}`}
          />
          <button type="submit" disabled={isSaving} className={`px-4 py-2 text-sm ${primaryButtonClass}`}>{isSaving ? "Saving…" : "Save"}</button>
          <button type="button" onClick={onCancel} className={`px-4 py-2 text-sm ${secondaryButtonClass}`}>Cancel</button>
        </div>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </form>
    );
  }

  if (!info.name && !info.tags.length) return null;
  return (
    <div className="note-creator" aria-label="Folder">
      {info.name && (info.linked
        ? <a href={folderHref()} className="font-medium text-foreground hover:underline">{info.name}</a>
        : <span className="font-medium">{info.name}</span>)}
      {info.tags.map(tag => info.linked
        ? <a key={tag} href={folderHref(tag)} className="creator-tag creator-tag-small">{tag}</a>
        : <span key={tag} className="creator-tag creator-tag-small">{tag}</span>)}
    </div>
  );
}
