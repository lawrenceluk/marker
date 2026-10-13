import { cache } from "react";
import { cookies } from "next/headers";
import { DEMO_KEY, METADATA_DEMO_KEY, REACTION_DEMO_KEY, ensurePreviewDemo } from "../lib/demo";
import { maskKey, persistPath } from "../lib/key";
import { readNote as loadNote } from "../lib/notes";
import { CREATOR_COOKIE, normalizeCreatorId } from "../lib/creatorId";
import { creatorHash } from "../lib/creators";
import type { FolderSummary } from "../lib/folders";
import { r2Config } from "../lib/r2";
import { assetUrlMap } from "../lib/assets";
import { shellForNote } from "../lib/embeds";
import { NoteApp } from "./NoteApp";

/** Shared by metadata and the page body so a request reads the note once. */
export const readPageNote = cache(async (key: string, recordAccess: boolean) => {
  await ensurePreviewDemo(key);
  return recordAccess ? loadNote(key, true, true) : loadNote(key);
});

function PreviewBanner() {
  if (process.env.VERCEL_ENV !== "preview") return null;
  return <aside className="bg-slab px-6 py-3.5 text-center text-sm text-on-slab-muted [&_a]:font-medium [&_a]:text-on-slab">Preview sandbox · Separate note namespace · <a className="underline" href={persistPath(METADATA_DEMO_KEY)}>Open metadata demo</a> · <a className="underline" href={persistPath(REACTION_DEMO_KEY)}>Open reaction demo</a> · <a className="underline" href={persistPath(DEMO_KEY)}>Open commenting demo</a></aside>;
}

/** Home (no key) or a note, server-rendered. */
export async function NoteView({
  noteKey,
  persist,
  folders,
}: {
  noteKey: string | null;
  persist: boolean;
  /** Remembered folders for Home; omitted on note pages, where Home loads them on demand. */
  folders?: FolderSummary[];
}) {
  const note = noteKey ? await readPageNote(noteKey, true) : null;
  const r2 = r2Config();
  const creatorId = normalizeCreatorId((await cookies()).get(CREATOR_COOKIE)?.value);
  const creator = note?.cid
    ? {
        hasCreator: true,
        name: note.creatorName,
        tags: note.tags,
        linked: creatorId !== null && creatorHash(creatorId) === note.cid,
      }
    : null;

  return (
    <>
      <PreviewBanner />
      <NoteApp
        initialKeyLabel={noteKey ? maskKey(noteKey) : null}
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
