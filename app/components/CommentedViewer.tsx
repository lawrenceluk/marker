"use client";

import { useEffect, useRef, useState } from "react";
import { ContentViewer } from "./ContentViewer";
import { sourceSelection } from "../lib/comment-markup";
import type { CommentOperation, LocatedThread } from "../lib/comments";

type Snapshot = { rev: number; content: string; comments: LocatedThread[] };
export function CommentedViewer({
  content,
  rev,
  onChange,
}: {
  content: string;
  rev: number;
  onChange: (content: string, rev: number) => void;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [selection, setSelection] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const threads = snapshot?.comments ?? [];
  const thread = threads.find((t) => t.id === active);

  useEffect(() => {
    if (!enabled) return;
    const changed = () => {
      if (dialog.current?.open) return;
      setSelection(root.current ? sourceSelection(root.current) : null);
    };
    document.addEventListener("selectionchange", changed);
    return () => document.removeEventListener("selectionchange", changed);
  }, [enabled]);

  async function load() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/comments?status=all", {
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setSnapshot(data);
      onChange(data.content, data.rev);
      setEnabled(true);
      setSelection(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function open(id: string) {
    setActive(id);
    setDraft("");
    setError("");
    dialog.current?.showModal();
  }
  async function submit(operation: CommentOperation) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          if_rev: snapshot?.rev ?? rev,
          operations: [operation],
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setSnapshot(data);
      onChange(data.content, data.rev);
      setDraft("");
      setSelection(null);
      if (operation.action === "create") setActive(data.comments.at(-1).id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const button =
    "min-h-11 rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm disabled:opacity-50";
  return (
    <>
      <div className="mb-4 flex items-center gap-3 text-sm">
        <button
          className={button}
          disabled={busy}
          onClick={() => (enabled ? setEnabled(false) : void load())}
          aria-pressed={enabled}
        >
          {enabled ? "Exit commenting" : "Comment on this note"}
        </button>
        {enabled && (
          <button
            className={button}
            disabled={busy}
            onClick={() => {
              void load();
              open("list");
            }}
          >
            Threads ({threads.filter((t) => !t.resolved).length})
          </button>
        )}
      </div>
      {enabled && (
        <p className="mb-4 text-sm text-zinc-500">
          Select text, then tap Comment. Anyone with this link can read and
          change comments.
        </p>
      )}
      {error && !dialog.current?.open && (
        <p role="alert" className="mb-4 text-red-600">
          {error}
        </p>
      )}
      <div
        ref={root}
        onClick={(event) => {
          if (!enabled || window.getSelection()?.toString()) return;
          const mark = (event.target as HTMLElement).closest<HTMLElement>(
            "[data-comments]",
          );
          if (mark) open(mark.dataset.comments!.split(" ")[0]);
        }}
      >
        <ContentViewer
          content={content}
          comments={enabled ? threads : undefined}
        />
      </div>
      {enabled && selection && (
        <button
          className={`${button} fixed bottom-6 left-1/2 -translate-x-1/2 z-20 bg-zinc-900 text-white shadow-lg`}
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => open("new")}
        >
          Comment on selection
        </button>
      )}
      <dialog
        ref={dialog}
        className="comment-sheet"
        onClose={() => setActive(null)}
      >
        <div className="flex items-center justify-between gap-4 mb-4">
          <h2 className="font-semibold">
            {active === "new"
              ? "New comment"
              : thread
                ? "Comment thread"
                : "Comments"}
          </h2>
          <button className={button} onClick={() => dialog.current?.close()}>
            Close
          </button>
        </div>
        {error && (
          <p role="alert" className="text-red-600 mb-3">
            {error}{" "}
            <button
              className="underline"
              disabled={busy}
              onClick={() => void load()}
            >
              Reload comments
            </button>
          </p>
        )}
        {active === "list" && (
          <>
            <label className="flex gap-2 mb-4">
              <input
                type="checkbox"
                checked={showResolved}
                onChange={(e) => setShowResolved(e.target.checked)}
              />
              Include resolved
            </label>
            {threads
              .filter((t) => showResolved || !t.resolved)
              .map((t) => (
                <button
                  className="block w-full text-left border-b border-zinc-300 py-3"
                  key={t.id}
                  onClick={() => {
                    setActive(t.id);
                    setDraft("");
                  }}
                >
                  <span className="text-xs text-zinc-500">
                    {t.resolved ? "Resolved" : "Open"}
                    {t.location.state === "outdated" ? " · Outdated" : ""}
                  </span>
                  <blockquote className="truncate">{t.anchor.exact}</blockquote>
                  <p className="truncate">
                    {t.messages[0].author}: {t.messages[0].text}
                  </p>
                </button>
              ))}
            {!threads.filter((t) => showResolved || !t.resolved).length && (
              <p>No comments here yet.</p>
            )}
          </>
        )}
        {(thread || active === "new") && (
          <>
            <blockquote className="whitespace-pre-wrap break-words border-l-2 border-amber-400 pl-3 mb-4">
              {thread?.anchor.exact ??
                (selection
                  ? content.slice(selection.start, selection.end)
                  : "")}
            </blockquote>
            {thread?.location.state === "outdated" && (
              <p className="text-sm mb-3">
                Outdated — this quote was removed or is ambiguous. The original
                quote is kept above.
              </p>
            )}
            {thread?.messages.map((message, index) => (
              <div key={index} className="mb-4">
                <p className="font-medium text-sm">{message.author}</p>
                <p className="whitespace-pre-wrap break-words">
                  {message.text}
                </p>
              </div>
            ))}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (thread)
                  void submit({ action: "reply", id: thread.id, text: draft });
                else if (selection)
                  void submit({ action: "create", ...selection, text: draft });
              }}
            >
              <label className="block mb-2" htmlFor="comment-text">
                {thread ? "Reply" : "Comment"} as You
              </label>
              <textarea
                id="comment-text"
                className="w-full rounded-lg border border-zinc-300 p-3 min-h-24"
                maxLength={4000}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              <div className="flex gap-2 mt-3">
                <button
                  className={button}
                  disabled={busy || !draft.trim() || (!thread && !selection)}
                >
                  Post {thread ? "reply" : "comment"}
                </button>
                {thread && (
                  <button
                    className={button}
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void submit({
                        action: thread.resolved ? "reopen" : "resolve",
                        id: thread.id,
                      })
                    }
                  >
                    {thread.resolved ? "Reopen" : "Resolve"}
                  </button>
                )}
              </div>
            </form>
          </>
        )}
      </dialog>
    </>
  );
}
