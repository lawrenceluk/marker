import { cache } from "react";
import { cookies } from "next/headers";
import { ensurePreviewDemo } from "../lib/demo";
import { maskKey } from "../lib/key";
import { after } from "next/server";
import { readNote as loadNote, recordPageNoteAccess } from "../lib/notes";
import { CREATOR_COOKIE, normalizeCreatorId } from "../lib/creatorId";
import { creatorHash } from "../lib/creators";
import { noteFolderHref } from "../lib/folders";
import { r2Config } from "../lib/r2";
import { assetUrlMap } from "../lib/assets";
import { frontMatter } from "../lib/frontmatter";
import { shellForNote } from "../lib/embeds";
import { NoteApp } from "./NoteApp";

/** One request-local snapshot for the page and its metadata. The standalone OG
 * image and note APIs retain their own read paths. */
export const readPageNote = cache(async (key: string) => {
  await ensurePreviewDemo(key);
  return loadNote(key, true);
});

/** Server-rendered note. */
export async function NoteView({
  noteKey,
  persist,
  noteBinding = null,
}: {
  noteKey: string;
  persist: boolean;
  /** Per-tab API binding; omitted on Home idle. */
  noteBinding?: string | null;
}) {
  const note = await readPageNote(noteKey);
  if (note) {
    after(() => recordPageNoteAccess(noteKey, note));
  }
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
        initialKeyLabel={maskKey(noteKey)}
        noteBinding={noteBinding}
        persistNoteKey={persist ? noteKey : null}
        initialNote={note ? { content: note.content, rev: note.rev, responses: note.responses } : null}
        initialMetadata={note ? frontMatter(note.content) : null}
        initialPersist={persist}
        initialCreator={creator}
        imagesEnabled={r2 !== null}
        initialAssetUrls={assetUrlMap(r2, note)}
        initialEmbedShellUrl={(await shellForNote(r2, note))?.url ?? null}
      />
    </>
  );
}
