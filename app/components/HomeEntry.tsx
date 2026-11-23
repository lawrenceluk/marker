"use client";

import { useState } from "react";
import { Home } from "lucide-react";
import { generateRandomKey } from "../lib/key";
import { noteApiHeaders } from "../lib/noteClient";
import type { FolderSummary } from "../lib/folders";
import { HomeIdle } from "./HomeIdle";
import { ToolbarButton } from "./ToolbarButton";

const RANDOMIZE_ATTEMPTS = 16;

export function HomeEntry({ folders }: { folders?: FolderSummary[] }) {
  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-3xl px-4 py-12">
        <HomeControls folders={folders} />
      </main>
    </div>
  );
}

export function HomeControls({ folders }: { folders?: FolderSummary[] }) {
  const [isLoading, setIsLoading] = useState(false);
  const [isRandomizing, setIsRandomizing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleKeySubmit(key: string) {
    setIsLoading(true);
    setError(null);

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
      setIsLoading(false);
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
    } finally {
      setIsRandomizing(false);
    }
  }

  return (
    <>
      {error && <div role="alert" className="banner-error mb-6">{error}</div>}
      {isLoading ? (
        <>
          <nav aria-label="Note actions" className="note-toolbar">
            <ToolbarButton label="Home" onClick={() => setIsLoading(false)} tooltipAlign="start"><Home size={18} /></ToolbarButton>
          </nav>
          <div className="flex justify-center">
            <div className="text-muted">Opening note…</div>
          </div>
        </>
      ) : (
        <HomeIdle
          folders={folders}
          onSubmit={handleKeySubmit}
          onRandomize={handleRandomize}
          isLoading={false}
          isRandomizing={isRandomizing}
        />
      )}
    </>
  );
}
