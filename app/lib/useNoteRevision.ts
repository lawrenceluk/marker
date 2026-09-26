"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Revision checks never fetch or replace document content. */
export function useNoteRevision(rev: number | null, enabled: boolean, identity: string | null) {
  const current = useRef(rev);
  current.current = rev;
  const [remote, setRemote] = useState<{ identity: string | null; rev: number } | null>(null);
  const noticeRevision = useCallback((next: number) => {
    setRemote(previous => ({ identity, rev: Math.max(next, previous?.identity === identity ? previous.rev : 0) }));
  }, [identity]);

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | null = null;
    let stopped = false;
    let unchanged = 0;
    let last = current.current;
    function pause() {
      clearTimeout(timer);
      controller?.abort();
      controller = null;
    }
    async function check() {
      if (stopped || document.visibilityState !== "visible" || controller) return;
      clearTimeout(timer);
      const request = new AbortController();
      controller = request;
      try {
        const response = await fetch("/api/revision", { cache: "no-store", signal: request.signal });
        if (!response.ok) throw new Error("Revision unavailable");
        const data = await response.json();
        if (request.signal.aborted || !Number.isSafeInteger(data.rev)) return;
        unchanged = data.rev === last ? unchanged + 1 : 0;
        last = data.rev;
        noticeRevision(data.rev);
      } catch {
        if (!request.signal.aborted) unchanged++; // Back off on errors too.
      } finally {
        if (controller === request) {
          controller = null;
          if (!stopped && document.visibilityState === "visible")
            timer = setTimeout(check, unchanged >= 3 ? 60_000 : 20_000);
        }
      }
    }
    function resume() {
      if (document.visibilityState !== "visible") pause();
      else { unchanged = 0; void check(); }
    }
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    void check();
    return () => {
      stopped = true;
      pause();
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
    };
  }, [enabled, identity, noticeRevision]);

  return { updated: remote?.identity === identity && rev !== null && remote.rev > rev, noticeRevision };
}
