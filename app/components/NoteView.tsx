import { cache } from "react";
import { cookies } from "next/headers";
import { ensurePreviewDemo } from "../lib/demo";
import { maskKey } from "../lib/key";
import { readNote as loadNote } from "../lib/notes";
import { CREATOR_COOKIE, normalizeCreatorId } from "../lib/creatorId";
import { creatorHash } from "../lib/creators";
import type { FolderSummary } from "../lib/folders";
import { noteFolderHref } from "../lib/folders";
import { r2Config } from "../lib/r2";
import { assetUrlMap } from "../lib/assets";
import { shellForNote } from "../lib/embeds";
import { NoteApp } from "./NoteApp";

/** Shared by metadata and the page body so a request reads the note once. */
export const readPageNote = cache(async (key: string, recordAccess: boolean) => {
  await ensurePreviewDemo(key);
  return recordAccess ? loadNote(key, true, true) : loadNote(key);
});

/** Home (no key) or a note, server-rendered. */
export async function NoteView({
  noteKey,
  persist,
  noteBinding = null,
  folders,
}: {
  noteKey: string | null;
  persist: boolean;
  /** Per-tab API binding; omitted on Home idle. */
  noteBinding?: string | null;
  /** Remembered folders for Home; omitted on note pages, where Home loads them on demand. */
  folders?: FolderSummary[];
}) {
  const note = noteKey ? await readPageNote(noteKey, true) : null;
  const r2 = r2Config();
  const jar = await cookies();
  const creatorId = normalizeCreatorId(jar.get(CREATOR_COOKIE)?.value);
  const creator = note?.cid
    ? {
        hasCreator: true,
        name: note.creatorName,
        tags: note.tags,
        linked: creatorId !== null && creatorHash(creatorId) === note.cid,
        folderHref: noteFolderHref(note.cid),
      }
    : null;

  return (
    <>
      <NoteApp
        initialKeyLabel={noteKey ? maskKey(noteKey) : null}
        noteBinding={noteBinding}
        persistNoteKey={persist && noteKey ? noteKey : null}
        initialNote={note ? { content: note.content, rev: note.rev, responses: note.responses } : null}
        initialPersist={persist}
        initialCreator={creator}
        initialFolders={folders}
        imagesEnabled={r2 !== null}
        initialAssetUrls={assetUrlMap(r2, note)}
        initialEmbedShellUrl={(await shellForNote(r2, note))?.url ?? null}
      />
    </>
  );
}
