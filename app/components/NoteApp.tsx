"use client";

import { useEffect, useState } from "react";
import {
  PERSIST_QUERY,
  isPersistParam,
  normalizeKey,
  persistPath,
} from "../lib/key";
import { KeyInput } from "./KeyInput";
import { ContentViewer } from "./ContentViewer";
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
  // Revision this editor loaded, sent back as if_rev so a save can't silently
  // clobber a write made elsewhere (an agent, another tab) in the meantime.
  const [rev, setRev] = useState<number | null>(
    initialNote?.rev ?? (initialKeyLabel ? 0 : null)
  );
  const [forceOverwrite, setForceOverwrite] = useState(false);
  const [persist, setPersist] = useState(initialPersist);
  const [isTogglingPersist, setIsTogglingPersist] = useState(false);
  // Raw key is kept only in memory (typed in, or revealed after persist is
  // on) so a default session still doesn't serialize it into the page HTML.
  const [rawKey, setRawKey] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);
  const [isSavingRename, setIsSavingRename] = useState(false);

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
      // Hand the key to the server once, then work through the session cookie
      // so it isn't repeated in every request URL or body.
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
        // A missing note reads as rev 0, so if_rev also gives us
        // create-only-if-still-absent on first save.
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
        // Someone wrote to this note after we loaded it. Don't discard the
        // user's draft — warn, and let a second Save go through unconditionally.
        setRev(data.rev ?? null);
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

  function handleCancel() {
    setContent(originalContent);
    if (isNew && !originalContent) {
      handleReset();
    } else {
      setAppState("viewing");
    }
  }

  function handleReset() {
    void fetch("/api/session", { method: "DELETE" }).catch(() => {});
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
        <header className="mb-12 text-left font-mono">
          <h1 className="text-3xl font-semibold text-zinc-900 dark:text-zinc-100 mb-2">
            Marker
          </h1>
          <p className="text-zinc-500 dark:text-zinc-400">
            Private markdown notes with secret keys
          </p>
        </header>

        {error && (
          <div className="mb-6 p-4 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-center">
            {error}
          </div>
        )}

        {appState === "idle" && (
          <KeyInput onSubmit={handleKeySubmit} isLoading={false} />
        )}

        {appState === "loading" && (
          <div className="flex justify-center">
            <div className="text-zinc-500 dark:text-zinc-400">Loading...</div>
          </div>
        )}

        {appState === "viewing" && (
          <div>
            <NoteToolbar
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
              renaming={isRenaming}
              onChangeKey={handleReset}
              content={content}
              onEdit={handleEdit}
            />
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
            <ContentViewer content={content} />
          </div>
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
