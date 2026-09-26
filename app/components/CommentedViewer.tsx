"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { Check, MessageCircle, RotateCcw, Send, X } from "lucide-react";
import { ContentViewer } from "./ContentViewer";
import { ToolbarButton } from "./ToolbarButton";
import { sourceSelection } from "../lib/comment-markup";
import type { CommentOperation, LocatedThread } from "../lib/comments";

type Snapshot = { rev: number; content: string; comments: LocatedThread[] };
type Selection = { start: number; end: number; x: number; y: number };
export function CommentedViewer({
  content,
  rev,
  onChange,
  toolbar,
}: {
  content: string;
  rev: number;
  onChange: (content: string, rev: number) => void;
  toolbar: (commentsButton: ReactNode) => ReactNode;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  const readVersion = useRef(0);
  const root = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const threads = snapshot?.comments ?? [];
  const thread = threads.find((t) => t.id === active);
  const openCount = threads.filter((t) => !t.resolved).length;

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const version = ++readVersion.current;
      try {
        const response = await fetch("/api/comments?status=all", {
          cache: "no-store",
          signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        if (signal?.aborted || version !== readVersion.current) return;
        setSnapshot(data);
        onChange(data.content, data.rev);
        setError("");
      } catch (e) {
        if (!signal?.aborted && version === readVersion.current)
          setError((e as Error).message);
      }
    },
    [onChange],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, rev]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    function position() {
      if (dialog.current?.open) return;
      const source = root.current ? sourceSelection(root.current) : null;
      const range = window.getSelection()?.rangeCount
        ? window.getSelection()!.getRangeAt(0)
        : null;
      const rect = range ? Array.from(range.getClientRects()).at(-1) : null;
      setSelection(
        source && rect
          ? {
              ...source,
              x: Math.max(8, Math.min(rect.right + 8, window.innerWidth - 48)),
              // Below the last line leaves the native callout above the selection alone.
              y: Math.max(
                8,
                Math.min(rect.bottom + 20, window.innerHeight - 48),
              ),
            }
          : null,
      );
    }
    function changed() {
      clearTimeout(timer);
      timer = setTimeout(position, 140);
    }
    function viewport() {
      const view = window.visualViewport;
      dialog.current?.style.setProperty(
        "--comment-bottom",
        `${view ? Math.max(0, window.innerHeight - view.height - view.offsetTop) : 0}px`,
      );
      dialog.current?.style.setProperty(
        "--comment-viewport",
        `${view?.height ?? window.innerHeight}px`,
      );
      position();
    }
    viewport();
    document.addEventListener("selectionchange", changed);
    window.addEventListener("scroll", position, true);
    window.visualViewport?.addEventListener("resize", viewport);
    window.visualViewport?.addEventListener("scroll", viewport);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("selectionchange", changed);
      window.removeEventListener("scroll", position, true);
      window.visualViewport?.removeEventListener("resize", viewport);
      window.visualViewport?.removeEventListener("scroll", viewport);
    };
  }, []);

  function open(id: string, rect: { left: number; bottom: number }) {
    // Mount and focus inside the tap's user activation, not an effect/timeout:
    // iOS can then show the keyboard without another tap on the field.
    flushSync(() => {
      setActive(id);
      setDraft("");
      setError("");
    });
    const sheet = dialog.current!;
    if (!sheet.open) sheet.showModal();
    sheet.style.setProperty("--comment-x", `${rect.left}px`);
    sheet.style.setProperty(
      "--comment-y",
      `${Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - sheet.offsetHeight - 12))}px`,
    );
    window.getSelection()?.removeAllRanges();
    if (id !== "list") input.current?.focus({ preventScroll: true });
  }
  async function submit(operation: CommentOperation) {
    if (busy) return;
    readVersion.current++;
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
      if (operation.action === "create") dialog.current?.close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function send() {
    if (!draft.trim() || busy) return;
    if (thread) void submit({ action: "reply", id: thread.id, text: draft });
    else if (selection)
      void submit({
        action: "create",
        start: selection.start,
        end: selection.end,
        text: draft,
      });
  }
  return (
    <>
      {toolbar(
        <ToolbarButton
          label={`Comments (${openCount} open)`}
          onClick={(e) => {
            open("list", e.currentTarget.getBoundingClientRect());
            void load();
          }}
        >
          <MessageCircle size={18} />
          {openCount > 0 && (
            <span className="comment-count" aria-hidden="true">
              {openCount}
            </span>
          )}
        </ToolbarButton>,
      )}
      {error && !active && (
        <p role="alert" className="mb-3 text-sm text-red-600">
          {error}
        </p>
      )}
      <div
        ref={root}
        onClick={(e) => {
          if (window.getSelection()?.toString()) return;
          const mark = (e.target as HTMLElement).closest<HTMLElement>(
            "[data-comments]",
          );
          if (mark)
            open(
              mark.dataset.comments!.split(" ")[0],
              mark.getBoundingClientRect(),
            );
        }}
      >
        <ContentViewer content={content} comments={threads} />
      </div>
      {selection && !active && (
        <ToolbarButton
          label="Comment on selection"
          className="comment-selection group"
          style={{ left: selection.x, top: selection.y }}
          onPointerDown={(e) => { if (e.pointerType === "mouse") e.preventDefault(); }}
          onClick={(e) => open("new", e.currentTarget.getBoundingClientRect())}
        >
          <MessageCircle size={18} />
        </ToolbarButton>
      )}
      <dialog
        ref={dialog}
        className="comment-sheet"
        aria-label={active === "list" ? "Comments" : "Comment thread"}
        onClose={() => {
          setActive(null);
          setSelection(null);
        }}
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) {
            const rect = e.currentTarget.getBoundingClientRect();
            if (
              e.clientX < rect.left ||
              e.clientX > rect.right ||
              e.clientY < rect.top ||
              e.clientY > rect.bottom
            )
              e.currentTarget.close();
          }
        }}
      >
        <div className="comment-heading">
          {active === "list" ? (
            <label className="text-xs text-zinc-500 flex items-center gap-2">
              <input
                type="checkbox"
                checked={showResolved}
                onChange={(e) => setShowResolved(e.target.checked)}
              />
              Include resolved
            </label>
          ) : (
            <blockquote className="comment-quote">
              {thread?.anchor.exact ??
                (selection
                  ? content.slice(selection.start, selection.end)
                  : "")}
            </blockquote>
          )}
          {thread && (
            <ToolbarButton
              className="comment-icon group"
              label={thread.resolved ? "Reopen" : "Resolve"}
              disabled={busy}
              onClick={() =>
                void submit({
                  action: thread.resolved ? "reopen" : "resolve",
                  id: thread.id,
                })
              }
            >
              {thread.resolved ? <RotateCcw size={16} /> : <Check size={16} />}
            </ToolbarButton>
          )}
          <ToolbarButton
            className="comment-icon group"
            label="Close"
            onClick={() => dialog.current?.close()}
          >
            <X size={16} />
          </ToolbarButton>
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}{" "}
            <button
              className="underline"
              disabled={busy}
              onClick={() => {
                setSelection(null);
                void load();
              }}
            >
              Reload comments
            </button>
          </p>
        )}
        {active === "list" ? (
          <>
            {threads
              .filter((t) => showResolved || !t.resolved)
              .map((t) => (
                <button
                  className="comment-row"
                  key={t.id}
                  onClick={(e) =>
                    open(t.id, e.currentTarget.getBoundingClientRect())
                  }
                >
                  <span className="text-xs text-zinc-500">
                    {t.resolved ? "Resolved" : "Open"}
                    {t.location.state === "outdated" ? " · Outdated" : ""}
                  </span>
                  <p className="truncate">{t.messages[0].text}</p>
                </button>
              ))}
            {!threads.filter((t) => showResolved || !t.resolved).length && (
              <p className="text-sm text-zinc-500 py-2">
                No comments yet. Select text to start one.
              </p>
            )}
          </>
        ) : (
          <>
            {thread?.location.state === "outdated" && (
              <p className="text-xs text-zinc-500 mb-2">
                Outdated · Original quote
              </p>
            )}
            <div className="comment-messages">
              {thread?.messages.map((message, index) => (
                <div key={index} className="mb-3">
                  <p className="text-xs text-zinc-500 mb-1">{message.author}</p>
                  <p className="text-sm whitespace-pre-wrap break-words">
                    {message.text}
                  </p>
                </div>
              ))}
            </div>
            <form
              className="comment-compose"
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
            >
              <textarea
                ref={input}
                aria-label={thread ? "Reply as You" : "Comment as You"}
                placeholder={thread ? "Reply…" : "Comment…"}
                rows={1}
                maxLength={4000}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing &&
                    (e.metaKey ||
                      e.ctrlKey ||
                      window.matchMedia("(pointer: fine)").matches)
                  ) {
                    e.preventDefault();
                    send();
                  }
                }}
              />
              <ToolbarButton
                className="comment-icon group"
                type="submit"
                label={thread ? "Send reply" : "Send comment"}
                disabled={busy || !draft.trim() || (!thread && !selection)}
              >
                <Send size={17} />
              </ToolbarButton>
            </form>
          </>
        )}
      </dialog>
    </>
  );
}
