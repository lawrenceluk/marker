"use client";

import { useState } from "react";
import { KeyInput } from "./components/KeyInput";
import { ContentViewer } from "./components/ContentViewer";
import { ContentEditor } from "./components/ContentEditor";
import { ScrollActions } from "./components/ScrollActions";

type AppState = "idle" | "loading" | "viewing" | "editing";

export default function Home() {
  const [appState, setAppState] = useState<AppState>("idle");
  const [currentKey, setCurrentKey] = useState("");
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [isNew, setIsNew] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleKeySubmit(key: string) {
    setAppState("loading");
    setError(null);
    setCurrentKey(key);

    try {
      const res = await fetch(`/api/content?key=${encodeURIComponent(key)}`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to fetch content");
      }

      if (data.exists) {
        setContent(data.content || "");
        setOriginalContent(data.content || "");
        setIsNew(false);
        setAppState("viewing");
      } else {
        setContent("");
        setOriginalContent("");
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
        body: JSON.stringify({ key: currentKey, content }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to save content");
      }

      setOriginalContent(content);
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
    setAppState("idle");
    setCurrentKey("");
    setContent("");
    setOriginalContent("");
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

        {(appState === "viewing" || appState === "editing") && (
          <div>
            <div className="flex items-center justify-between mb-6 pb-4 border-b border-zinc-200 dark:border-zinc-800">
              <span className="text-sm text-zinc-500 dark:text-zinc-400 font-mono">
                {currentKey.length > 8 ? `****${currentKey.slice(-4)}` : "****"}
              </span>
              <button
                onClick={handleReset}
                className="text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
              >
                Change Key
              </button>
            </div>

            {appState === "viewing" && (
              <ContentViewer content={content} onEdit={handleEdit} />
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
          </div>
        )}
      </main>
      <ScrollActions />
    </div>
  );
}
