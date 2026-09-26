"use client";

import { useCallback, useEffect, useState } from "react";
import {
  PERSIST_QUERY,
  generateRandomKey,
  isPersistParam,
  normalizeKey,
  persistPath,
} from "../lib/key";
import { useNoteRevision } from "../lib/useNoteRevision";
import { HomeIdle } from "./HomeIdle";
import { CommentedViewer } from "./CommentedViewer";
import { ContentEditor } from "./ContentEditor";
import { NoteToolbar } from "./NoteToolbar";
import { RenameKey } from "./RenameKey";
import { ScrollActions } from "./ScrollActions";

type AppState = "idle" | "loading" | "viewing" | "editing";

interface NoteAppProps {
  /**
   * Masked label for the key in the session cookie, or null if there's no
   * session. Deliberately masked: the raw key would otherwise be serialised
   * into the page's HTML, which is exactly what moving it into a cookie was
   * meant to avoid. Requests authenticate with the cookie instead.
   */
  initialKeyLabel: string | null;
  /** The note that key names, or null if it doesn't exist yet. */
  initialNote: { content: string; rev: number } | null;
  /** Whether this session is a persistent document link. */
  initialPersist: boolean;
}

const RANDOMIZE_ATTEMPTS = 16;

export function NoteApp({
  initialKeyLabel,
  initialNote,
  initialPersist,
}: NoteAppProps) {
  const [appState, setAppState] = useState<AppState>(
    initialKeyLabel ? (initialNote ? "viewing" : "editing") : "idle"
  );
  const [content, setContent] = useState(initialNote?.content ?? "");
  const [originalContent, setOriginalContent] = useState(initialNote?.content ?? "");
  const [isNew, setIsNew] = useState(Boolean(initialKeyLabel) && !initialNote);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rev, setRev] = useState<number | null>(
    initialNote?.rev ?? (initialKeyLabel ? 0 : null)
  );
  const [forceOverwrite, setForceOverwrite] = useState(false);
  const [persist, setPersist] = useState(initialPersist);
  const [isTogglingPersist, setIsTogglingPersist] = useState(false);
  const [rawKey, setRawKey] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);
  const [isSavingRename, setIsSavingRename] = useState(false);
  const [isRandomizing, setIsRandomizing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  const [deleteResetKey, setDeleteResetKey] = useState(0);
  const [isComposing, setIsComposing] = useState(false);
  const { updated, noticeRevision } = useNoteRevision(
    rev, (appState === "viewing" || appState === "editing") && !isNew,
    rawKey ?? initialKeyLabel,
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

    void fetch("/api/session")
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
  }, [initialPersist]);

  const handleCommentChange = useCallback((next: string, revision: number) => {
    setContent(next);
    setOriginalContent(next);
    setRev(revision);
  }, []);

  function showPersistUrl(key: string) {
    window.history.replaceState(null, "", persistPath(key));
  }

  function hidePersistUrl() {
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      if (!session.ok) {
        throw new Error("Failed to open note");
      }

      const res = await fetch("/api/content");
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to fetch content");
      }

      if (data.exists) {
        setContent(data.content || "");
        setOriginalContent(data.content || "");
        setRev(data.rev ?? null);
        setIsNew(false);
        setAppState("viewing");
      } else {
        setContent("");
        setOriginalContent("");
        setRev(0);
        setIsNew(true);
        setAppState("editing");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
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
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key }),
        });
        if (!session.ok) {
          throw new Error("Failed to open note");
        }

        const res = await fetch("/api/content");
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Failed to check key");
        }

        if (!data.exists) {
          setRawKey(key);
          setPersist(false);
          setContent("");
          setOriginalContent("");
          setRev(0);
          setForceOverwrite(false);
          setIsNew(true);
          setIsRenaming(false);
          setAppState("editing");
          return;
        }
      }

      throw new Error("Couldn't find an unused key — try again");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to randomize");
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
      const res = await fetch("/api/content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          ...(forceOverwrite || rev === null ? {} : { if_rev: rev }),
        }),
      });

      const data = await res.json();

      if (res.status === 409) {
        if (Number.isSafeInteger(data.rev)) noticeRevision(data.rev);
        setForceOverwrite(true);
        setError(
          "This note changed elsewhere since you opened it. Saving again will overwrite that version."
        );
        return;
      }

      if (!res.ok) {
        throw new Error(data.error || "Failed to save content");
      }

      setOriginalContent(content);
      setRev(data.rev ?? null);
      setForceOverwrite(false);
      setIsNew(false);
      setAppState("viewing");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
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
      const res = await fetch("/api/content");
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to reload");
      }

      setIsRenaming(false);
      setForceOverwrite(false);
      setDeleteResetKey((k) => k + 1);

      if (data.exists) {
        setContent(data.content || "");
        setOriginalContent(data.content || "");
        setRev(data.rev ?? null);
        setIsNew(false);
        setAppState("viewing");
      } else {
        setContent("");
        setOriginalContent("");
        setRev(0);
        setIsNew(true);
        setAppState("editing");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reload");
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
      await fetch("/api/session", { method: "DELETE" });
    } catch {
      // Still reset the UI even if the cookie clear fails.
    }
    hidePersistUrl();
    setAppState("idle");
    setRawKey(null);
    setPersist(false);
    setContent("");
    setOriginalContent("");
    setRev(null);
    setForceOverwrite(false);
    setIsNew(false);
    setIsRenaming(false);
    setError(null);
  }

  async function handleDelete() {
    setIsDeleting(true);
    setError(null);

    try {
      const res = await fetch("/api/content", { method: "DELETE" });
      const data: { error?: string } = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to delete note");
      }

      hidePersistUrl();
      setAppState("idle");
      setRawKey(null);
      setPersist(false);
      setContent("");
      setOriginalContent("");
      setRev(null);
      setForceOverwrite(false);
      setIsNew(false);
      setIsRenaming(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete note");
    } finally {
      setIsDeleting(false);
    }
  }

  async function handleRename(newKey: string) {
    const next = normalizeKey(newKey);
    if (!next) {
      setError("Key is required");
      return;
    }

    setIsSavingRename(true);
    setError(null);

    try {
      const res = await fetch("/api/content", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ new_key: next }),
      });
      const data: { error?: string; key?: string } = await res.json();

      if (res.status === 409) {
        setError(data.error || "That key already exists");
        return;
      }
      if (!res.ok) {
        throw new Error(data.error || "Failed to rename key");
      }

      const key = normalizeKey(data.key) ?? next;
      setRawKey(key);
      setIsRenaming(false);
      if (persist) {
        showPersistUrl(key);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rename key");
    } finally {
      setIsSavingRename(false);
    }
  }

  async function handlePersistToggle() {
    const next = !persist;
    setIsTogglingPersist(true);
    setError(null);

    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ persist: next }),
      });
      const data: { persist?: boolean; key?: string; error?: string } =
        await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to update persistent URL");
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
      setError(err instanceof Error ? err.message : "Failed to update persistent URL");
    } finally {
      setIsTogglingPersist(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black">
      <main className="mx-auto max-w-3xl px-4 py-12">
        {appState !== "viewing" && appState !== "idle" && (
          <NoteToolbar
            onHome={() => void handleReset()}
            showNoteTools={false}
          />
        )}

        {error && (
          <div className="mb-6 p-4 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-center">
            {error}
          </div>
        )}

        {appState === "idle" && (
          <HomeIdle
            onSubmit={handleKeySubmit}
            onRandomize={handleRandomize}
            isLoading={false}
            isRandomizing={isRandomizing}
          />
        )}

        {appState === "loading" && (
          <div className="flex justify-center">
            <div className="text-zinc-500 dark:text-zinc-400">Loading...</div>
          </div>
        )}

        {appState === "viewing" && (
          <CommentedViewer key={rawKey ?? initialKeyLabel} content={content} rev={rev ?? 0} onChange={handleCommentChange} onRevision={noticeRevision} onComposingChange={setIsComposing} toolbar={commentsButton => <>
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
              content={content}
              onEdit={handleEdit}
              onDelete={handleDelete}
              deleteDisabled={isDeleting || isReloading}
            />
            {updated && !isComposing && (
              <button type="button" className="update-nudge" disabled={isReloading} onClick={() => void handleReload()}>
                {isReloading ? "Refreshing…" : "Updated · tap to refresh"}
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
          />
        )}
      </main>
      <ScrollActions />
    </div>
  );
}
