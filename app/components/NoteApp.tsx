"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  PERSIST_QUERY,
  generateRandomKey,
  isPersistParam,
  normalizeKey,
  persistPath,
} from "../lib/key";
import { apiErrorMessage, isNoteSwitchedResponse, noteApiHeaders, readJsonSafe } from "../lib/noteClient";
import { useNoteRevision } from "../lib/useNoteRevision";
import { NoteSessionProvider, useNoteSession } from "./NoteSession";
import { HomeIdle } from "./HomeIdle";
import { CommentedViewer } from "./CommentedViewer";
import { frontMatter } from "../lib/frontmatter";
import { ContentEditor } from "./ContentEditor";
import { AssetUrlsProvider, urlsFromAssets } from "./NoteImage";
import { NoteToolbar } from "./NoteToolbar";
import { RenameKey } from "./RenameKey";
import { ScrollActions } from "./ScrollActions";
import { NoteToast } from "./NoteToast";

const DUPLICATE_ARRIVAL_FLAG = "marker:duplicate-arrival";
const DUPLICATE_ARRIVAL_DISMISS_MS = 6000;
import { NoteCreator, creatorFromResponse, type NoteCreatorInfo } from "./NoteCreator";
import type { ResponseEntry } from "../lib/responses";
import type { FolderSummary } from "../lib/folders";

type AppState = "idle" | "loading" | "viewing" | "editing";

interface NoteAppProps {
  /**
   * Masked label for the key in the session cookie, or null if there's no
   * session. Deliberately masked: the raw key would otherwise be serialised
   * into the page's HTML, which is exactly what moving it into a cookie was
   * meant to avoid. Requests authenticate with the cookie instead.
   */
  initialKeyLabel: string | null;
  /** Per-tab binding for browser API calls; null on Home idle. */
  noteBinding?: string | null;
  /** Key from a persist URL; sent on API calls when the session cookie is gone. */
  persistNoteKey?: string | null;
  /** The note that key names, or null if it doesn't exist yet. */
  initialNote: { content: string; rev: number; responses: ResponseEntry[] } | null;
  /** Whether this session is a persistent document link. */
  initialPersist: boolean;
  /** Creator name and tags of the initial note, if it has a creator. */
  initialCreator?: NoteCreatorInfo | null;
  /** Remembered folders for Home; undefined means Home fetches them itself. */
  initialFolders?: FolderSummary[];
  /** Whether this deployment has image storage configured. */
  imagesEnabled?: boolean;
  /** View URLs for the initial note's images and embeds, by asset id. */
  initialAssetUrls?: Record<string, string>;
  /** View URL of this bucket's embed shell document. */
  initialEmbedShellUrl?: string | null;
}

const RANDOMIZE_ATTEMPTS = 16;
const NO_URLS: Record<string, string> = {};

export function NoteApp(props: NoteAppProps) {
  return (
    <NoteSessionProvider
      binding={props.noteBinding ?? null}
      persistKey={props.persistNoteKey ?? null}
    >
      <NoteAppBody {...props} />
    </NoteSessionProvider>
  );
}

function sessionNotePath(binding: string | null) {
  const match = /^\/n\/[A-Za-z0-9_-]+$/.exec(window.location.pathname);
  if (match) return match[0];
  const dot = binding?.indexOf(".");
  if (binding && dot && dot > 0) return `/n/${binding.slice(0, dot)}`;
  return "/n";
}

function NoteAppBody({
  initialKeyLabel,
  noteBinding = null,
  persistNoteKey = null,
  initialNote,
  initialPersist,
  initialCreator = null,
  initialFolders,
  imagesEnabled = false,
  initialAssetUrls = NO_URLS,
  initialEmbedShellUrl = null,
}: NoteAppProps) {
  const { binding: activeBinding, noteFetch } = useNoteSession();
  const tabBinding = activeBinding ?? noteBinding;
  const [appState, setAppState] = useState<AppState>(
    initialKeyLabel ? (initialNote ? "viewing" : "editing") : "idle"
  );
  const [content, setContent] = useState(initialNote?.content ?? "");
  const [originalContent, setOriginalContent] = useState(initialNote?.content ?? "");
  const [responses, setResponses] = useState<ResponseEntry[]>(initialNote?.responses ?? []);
  const [isNew, setIsNew] = useState(Boolean(initialKeyLabel) && !initialNote);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rev, setRev] = useState<number | null>(
    initialNote?.rev ?? (initialKeyLabel ? 0 : null)
  );
  const [forceOverwrite, setForceOverwrite] = useState(false);
  const [assetUrls, setAssetUrls] = useState(initialAssetUrls);
  const [persist, setPersist] = useState(initialPersist);
  const [isTogglingPersist, setIsTogglingPersist] = useState(false);
  const [rawKey, setRawKey] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);
  const [isSavingRename, setIsSavingRename] = useState(false);
  const [isRandomizing, setIsRandomizing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    action?: { label: string; onClick: () => void };
    error?: boolean;
    autoDismissMs?: number;
  } | null>(null);
  const [isReloading, setIsReloading] = useState(false);
  const [deleteResetKey, setDeleteResetKey] = useState(0);
  const [isComposing, setIsComposing] = useState(false);
  const [creator, setCreator] = useState<NoteCreatorInfo | null>(initialCreator);
  const metadata = useMemo(() => frontMatter(content), [content]);
  const [isEditingTags, setIsEditingTags] = useState(false);
  const [isSavingTags, setIsSavingTags] = useState(false);
  const { updated, noticeRevision } = useNoteRevision(
    rev,
    (appState === "viewing" || appState === "editing") && !isNew,
    persistNoteKey ?? rawKey ?? initialKeyLabel,
    noteFetch,
  );

  useEffect(() => {
    setOrigin(window.location.origin);

    const params = new URLSearchParams(window.location.search);
    const fromUrl = normalizeKey(params.get("key"));
    if (fromUrl && isPersistParam(params.get(PERSIST_QUERY))) {
      setRawKey(fromUrl);
      setPersist(true);
      return;
    }

    if (!initialPersist) return;

    void noteFetch("/api/session")
      .then((res) => res.json())
      .then((data: { persist?: boolean; key?: string }) => {
        const key = normalizeKey(data.key);
        if (data.persist && key) {
          setRawKey(key);
          setPersist(true);
          window.history.replaceState(null, "", persistPath(key));
        }
      })
      .catch(() => {});
  }, [initialPersist, noteFetch]);

  // Seeing the page is what marks a note seen. It runs after hydration (link unfurlers and
  // other bots that only fetch HTML never count) and waits until the tab is visible. It names
  // the revision that was rendered, so a change that lands in between still shows as new.
  useEffect(() => {
    if (!initialNote) return;
    const urlKey = normalizeKey(new URLSearchParams(window.location.search).get("key"));
    const body = JSON.stringify({ ...(urlKey ? { key: urlKey } : {}), seen: true, rev: initialNote.rev });
    const mark = () => {
      if (document.visibilityState !== "visible") return false;
      void noteFetch("/api/meta", { method: "PATCH", headers: { "Content-Type": "application/json" }, body }).catch(() => {});
      return true;
    };
    if (mark()) return;
    const onVisible = () => { if (mark()) document.removeEventListener("visibilitychange", onVisible); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [initialNote, noteFetch]);

  useEffect(() => {
    if (appState !== "viewing") return;
    if (sessionStorage.getItem(DUPLICATE_ARRIVAL_FLAG) !== "1") return;
    sessionStorage.removeItem(DUPLICATE_ARRIVAL_FLAG);
    setToast({
      message: "Viewing duplicate",
      action: {
        label: "Change key",
        onClick: () => {
          setIsRenaming(true);
          setError(null);
          setToast(null);
        },
      },
      autoDismissMs: DUPLICATE_ARRIVAL_DISMISS_MS,
    });
  }, [appState, rawKey, initialKeyLabel]);

  useEffect(() => {
    if (!toast?.autoDismissMs) return;
    const id = window.setTimeout(() => setToast(null), toast.autoDismissMs);
    return () => window.clearTimeout(id);
  }, [toast]);

  // Opening a note from Home pushes `/n`; going Back to `/` should show Home,
  // which the server decides.
  useEffect(() => {
    const onPop = () => window.location.reload();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const handleCommentChange = useCallback((next: string, revision: number, nextResponses: ResponseEntry[]) => {
    setContent(next);
    setOriginalContent(next);
    setRev(revision);
    setResponses(nextResponses);
  }, []);

  function showPersistUrl(key: string) {
    window.history.replaceState(null, "", persistPath(key));
  }

  /** Back to the session note's URL; `/` would reopen on Home. */
  function hidePersistUrl() {
    window.history.replaceState(null, "", sessionNotePath(tabBinding));
  }

  function showHomeUrl() {
    window.history.replaceState(null, "", "/");
  }

  async function handleKeySubmit(key: string) {
    setAppState("loading");
    setError(null);
    setForceOverwrite(false);
    setRawKey(key);
    setPersist(false);

    try {
      const session = await fetch("/api/session", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      const sessionData = await session.json();
      if (!session.ok || typeof sessionData.handle !== "string") {
        throw new Error("Couldn't open note. Try again.");
      }

      // Land on `/n/<handle>` so the note is seen once (after-load PATCH /api/meta), not again via GET /api/content.
      window.location.assign(`/n/${sessionData.handle}`);
      return;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't open note. Try again.");
      setRawKey(null);
      setAppState("idle");
    }
  }

  async function handleRandomize() {
    setIsRandomizing(true);
    setError(null);

    try {
      for (let i = 0; i < RANDOMIZE_ATTEMPTS; i++) {
        const key = generateRandomKey();

        const session = await fetch("/api/session", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key }),
        });
        const sessionData = await session.json();
        if (!session.ok || typeof sessionData.binding !== "string") {
          throw new Error("Couldn't create note. Try again.");
        }

        const res = await fetch("/api/content", {
          headers: noteApiHeaders(sessionData.binding),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Couldn't create note. Try again.");
        }

        if (!data.exists) {
          window.location.assign(`/n/${sessionData.handle}`);
          return;
        }
      }

      throw new Error("Couldn't find an unused key. Try again.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create note. Try again.");
      setRawKey(null);
      setAppState("idle");
    } finally {
      setIsRandomizing(false);
    }
  }

  async function handleSave() {
    setIsSaving(true);
    setError(null);

    try {
      const res = await noteFetch("/api/content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          ...(forceOverwrite || rev === null ? {} : { if_rev: rev }),
        }),
      });

      const data = await readJsonSafe(res);

      if (isNoteSwitchedResponse(res.status, data)) return;

      if (res.status === 409) {
        if (Number.isSafeInteger(data.rev)) noticeRevision(data.rev as number);
        setForceOverwrite(true);
        setError(
          "This note changed elsewhere since you opened it. Saving again will overwrite that version."
        );
        return;
      }

      if (!res.ok) {
        throw new Error(apiErrorMessage(data, "Couldn't save note. Try again."));
      }

      setOriginalContent(content);
      setRev(typeof data.rev === "number" ? data.rev : null);
      setForceOverwrite(false);
      setIsNew(false);
      setAppState("viewing");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save note. Try again.");
    } finally {
      setIsSaving(false);
    }
  }

  function handleEdit() {
    setAppState("editing");
  }

  async function handleReload() {
    setIsReloading(true);
    setError(null);

    try {
      const res = await noteFetch("/api/content");
      const data = await readJsonSafe(res);

      if (isNoteSwitchedResponse(res.status, data)) return;

      if (!res.ok) {
        throw new Error((data.error as string) || "Couldn't refresh note. Try again.");
      }

      setIsRenaming(false);
      setForceOverwrite(false);
      setDeleteResetKey((k) => k + 1);
      setCreator(creatorFromResponse(data));
      setIsEditingTags(false);

      if (data.exists) {
        const nextContent = typeof data.content === "string" ? data.content : "";
        setContent(nextContent);
        setOriginalContent(nextContent);
        setResponses(Array.isArray(data.responses) ? data.responses : []);
        setAssetUrls(urlsFromAssets(data.assets));
        setRev(typeof data.rev === "number" ? data.rev : null);
        setIsNew(false);
        setAppState("viewing");
      } else {
        setContent("");
        setOriginalContent("");
        setResponses([]);
        setRev(0);
        setIsNew(true);
        setAppState("editing");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't refresh note. Try again.");
    } finally {
      setIsReloading(false);
    }
  }

  function handleCancel() {
    setContent(originalContent);
    if (isNew && !originalContent) {
      void handleReset();
    } else {
      setAppState("viewing");
    }
  }

  /** Clear session cookies, strip persist URL, return to idle home. */
  async function handleReset() {
    try {
      await noteFetch("/api/session", { method: "DELETE" });
    } catch {
      // Still reset the UI even if the cookie clear fails.
    }
    showHomeUrl();
    setAppState("idle");
    setRawKey(null);
    setPersist(false);
    setContent("");
    setOriginalContent("");
    setResponses([]);
    setRev(null);
    setForceOverwrite(false);
    setIsNew(false);
    setIsRenaming(false);
    setCreator(null);
    setIsEditingTags(false);
    setError(null);
  }

  async function handleDuplicate() {
    setIsDuplicating(true);
    setToast({ message: "Duplicating…" });

    try {
      const res = await noteFetch("/api/content/duplicate", { method: "POST" });
      const data = await readJsonSafe(res);
      if (isNoteSwitchedResponse(res.status, data)) {
        setToast(null);
        return;
      }
      if (!res.ok) {
        setToast({
          message: apiErrorMessage(data, "Couldn't duplicate note. Try again."),
          error: true,
        });
        return;
      }
      sessionStorage.setItem(DUPLICATE_ARRIVAL_FLAG, "1");
      const handle = typeof data.handle === "string" ? data.handle : "";
      const destKey = typeof data.key === "string" ? normalizeKey(data.key) : null;
      const url =
        persist && destKey ? persistPath(destKey) : handle ? `/n/${handle}` : sessionNotePath(tabBinding);
      window.location.assign(url);
      return;
    } catch {
      setToast({ message: "Couldn't duplicate note. Try again.", error: true });
    } finally {
      setIsDuplicating(false);
    }
  }

  async function handleDelete() {
    setIsDeleting(true);
    setError(null);

    try {
      const res = await noteFetch("/api/content", { method: "DELETE" });
      const data = await readJsonSafe(res);
      if (isNoteSwitchedResponse(res.status, data)) return;
      if (!res.ok) {
        throw new Error(apiErrorMessage(data, "Couldn't delete note. Try again."));
      }

      showHomeUrl();
      setAppState("idle");
      setRawKey(null);
      setPersist(false);
      setContent("");
      setOriginalContent("");
      setResponses([]);
      setRev(null);
      setForceOverwrite(false);
      setIsNew(false);
      setIsRenaming(false);
      setCreator(null);
      setIsEditingTags(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't delete note. Try again.");
    } finally {
      setIsDeleting(false);
    }
  }

  async function handleRename(newKey: string) {
    const next = normalizeKey(newKey);
    if (!next) {
      setError("Enter a new key.");
      return;
    }

    setIsSavingRename(true);
    setError(null);

    try {
      const res = await noteFetch("/api/content", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ new_key: next }),
      });
      const data = await readJsonSafe(res);

      if (isNoteSwitchedResponse(res.status, data)) return;

      if (res.status === 409) {
        setError(apiErrorMessage(data, "That key is taken. Choose another."));
        return;
      }
      if (!res.ok) {
        throw new Error(apiErrorMessage(data, "Couldn't change key. Try again."));
      }

      const key = normalizeKey(typeof data.key === "string" ? data.key : null) ?? next;
      setRawKey(key);
      setIsRenaming(false);
      if (persist) {
        showPersistUrl(key);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't change key. Try again.");
    } finally {
      setIsSavingRename(false);
    }
  }

  /** The folder cookie is the proof; the note key comes from the session cookie. */
  async function handleSaveTags(tags: string[]) {
    setIsSavingTags(true);
    setError(null);
    try {
      const res = await noteFetch("/api/meta", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags }),
      });
      const data = await readJsonSafe(res);
      if (isNoteSwitchedResponse(res.status, data)) return;
      if (!res.ok) {
        throw new Error(apiErrorMessage(data, "Couldn't save tags. Try again."));
      }
      setCreator(current => current && {
        ...current,
        hasCreator: Boolean(data.has_creator),
        name: typeof data.creator_name === "string" ? data.creator_name : current.name,
        tags: Array.isArray(data.tags) ? data.tags : [],
      });
      setIsEditingTags(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save tags. Try again.");
    } finally {
      setIsSavingTags(false);
    }
  }

  async function handlePersistToggle() {
    const next = !persist;
    setIsTogglingPersist(true);
    setError(null);

    try {
      const res = await noteFetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ persist: next }),
      });
      const data: { persist?: boolean; key?: string; error?: string } =
        await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Couldn't update persistent link. Try again.");
      }

      const key = normalizeKey(data.key) ?? rawKey;
      setPersist(next);
      if (next && key) {
        setRawKey(key);
        showPersistUrl(key);
      } else {
        hidePersistUrl();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't update persistent link. Try again.");
    } finally {
      setIsTogglingPersist(false);
    }
  }

  return (
    <AssetUrlsProvider enabled={imagesEnabled} urls={assetUrls} embedShellUrl={initialEmbedShellUrl}>
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-3xl px-4 py-12">
        {appState !== "viewing" && appState !== "idle" && (
          <NoteToolbar
            onHome={() => void handleReset()}
            showNoteTools={false}
          />
        )}

        {error && (
          <div role="alert" className="banner-error mb-6">
            {error}
          </div>
        )}

        {appState === "idle" && (
          <HomeIdle
            folders={initialFolders}
            onSubmit={handleKeySubmit}
            onRandomize={handleRandomize}
            isLoading={false}
            isRandomizing={isRandomizing}
          />
        )}

        {appState === "loading" && (
          <div className="flex justify-center">
            <div className="text-muted">Opening note…</div>
          </div>
        )}

        {appState === "viewing" && (
          <CommentedViewer key={rawKey ?? initialKeyLabel} content={content} rev={rev ?? 0} initialResponses={responses} onChange={handleCommentChange} onRevision={noticeRevision} onComposingChange={setIsComposing} toolbar={commentsButton => <>
            <NoteToolbar
              commentsButton={commentsButton}
              key={deleteResetKey}
              onHome={() => void handleReset()}
              showNoteTools
              persist={persist}
              shareUrl={
                persist && rawKey && origin
                  ? `${origin}${persistPath(rawKey)}`
                  : null
              }
              onPersistToggle={handlePersistToggle}
              persistDisabled={isTogglingPersist}
              onRename={() => {
                setIsRenaming((open) => !open);
                setError(null);
              }}
              onChangeKey={() => void handleReset()}
              onDuplicate={() => void handleDuplicate()}
              duplicateDisabled={isDuplicating || isDeleting || isReloading}
              content={content}
              onEdit={handleEdit}
              onDelete={handleDelete}
              deleteDisabled={isDeleting || isReloading || isDuplicating}
              onEditTags={creator?.hasCreator && creator.linked ? () => {
                setIsEditingTags(true);
                setError(null);
              } : undefined}
            />
            <NoteCreator
                key={isEditingTags ? "editing" : "viewing"}
                info={creator}
                metadata={metadata}
                editing={isEditingTags}
                isSaving={isSavingTags}
                onSave={tags => void handleSaveTags(tags)}
                onCancel={() => setIsEditingTags(false)}
              />
            {updated && !isComposing && (
              <button type="button" className="update-nudge" disabled={isReloading} aria-busy={isReloading} onClick={() => void handleReload()}>
                {isReloading ? "Refreshing…" : "Note updated · Refresh"}
              </button>
            )}
            {isRenaming && (
              <div className="mb-6">
                <RenameKey
                  currentKey={rawKey}
                  onRename={handleRename}
                  onCancel={() => {
                    setIsRenaming(false);
                    setError(null);
                  }}
                  isSaving={isSavingRename}
                />
              </div>
            )}
          </>} />
        )}

        {appState === "editing" && (
          <ContentEditor
            content={content}
            onChange={setContent}
            onSave={handleSave}
            onCancel={handleCancel}
            isSaving={isSaving}
            isNew={isNew}
            imagesEnabled={imagesEnabled}
          />
        )}
      </main>
      {appState !== "idle" && <ScrollActions />}
      {toast && (
        <NoteToast
          message={toast.message}
          action={toast.action}
          error={toast.error}
        />
      )}
    </div>
    </AssetUrlsProvider>
  );
}
