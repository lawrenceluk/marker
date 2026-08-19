"use client";

import { useState } from "react";
import { maskKey } from "../lib/key";
import { KeyInput } from "./KeyInput";
import { ContentViewer } from "./ContentViewer";
import { ContentEditor } from "./ContentEditor";
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
}

export function NoteApp({ initialKeyLabel, initialNote }: NoteAppProps) {
  const [appState, setAppState] = useState<AppState>(
    initialKeyLabel ? (initialNote ? "viewing" : "editing") : "idle"
  );
  const [keyLabel, setKeyLabel] = useState(initialKeyLabel ?? "");
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

  async function handleKeySubmit(key: string) {
    setAppState("loading");
    setError(null);
    setForceOverwrite(false);
    setKeyLabel(maskKey(key));

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
    setAppState("idle");
    setKeyLabel("");
    setContent("");
    setOriginalContent("");
    setRev(null);
    setForceOverwrite(false);
    setIsNew(false);
    setError(null);
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
            <div className="flex items-center justify-between mb-6 pb-4 border-b border-zinc-200 dark:border-zinc-800">
              <span className="text-sm text-zinc-500 dark:text-zinc-400 font-mono">
                {keyLabel}
              </span>
              <button
                onClick={handleReset}
                className="text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
              >
                Change Key
              </button>
            </div>
            <ContentViewer content={content} onEdit={handleEdit} />
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
