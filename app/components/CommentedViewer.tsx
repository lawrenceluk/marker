"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { Check, MessageCircle, Minus, Plus, RotateCcw, Send, X } from "lucide-react";
import { ContentViewer } from "./ContentViewer";
import { ToolbarButton } from "./ToolbarButton";
import { plainQuote, selectionBubble } from "../lib/comment-presentation";
import { selectSourceRange, sourceSelection, tapSourceOffset } from "../lib/comment-markup";
import { adjacentSizeCandidate, heuristicRanking, tapCandidates, tapContext, type TapCandidate } from "../lib/tap-select";
import type { CommentOperation, LocatedThread } from "../lib/comments";

type Snapshot = { rev: number; content: string; comments: LocatedThread[] };
type RankAnswer = { ranking: number[]; source: string; timing?: { route_ms?: number; typesafe_ms?: number; outcome?: string; region?: string } };
type AutoSelection = { candidates: TapCandidate[]; ranking: number[]; index: number; source: string; latency: number; requestId: number };
type Selection = {
  start: number;
  end: number;
  x: number;
  y: number;
  size: number;
  text: string;
};
export function CommentedViewer({
  content,
  rev,
  onChange,
  onRevision,
  onComposingChange,
  toolbar,
  tapSelectPreview,
}: {
  content: string;
  rev: number;
  onChange: (content: string, rev: number) => void;
  onRevision: (rev: number) => void;
  onComposingChange: (composing: boolean) => void;
  toolbar: (commentsButton: ReactNode) => ReactNode;
  tapSelectPreview: boolean;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [tapMode, setTapMode] = useState<"jev" | "heuristic">("jev");
  const [tapWait, setTapWait] = useState<200 | 700>(700);
  const [tapDiagnostic, setTapDiagnostic] = useState("");
  const autoSelection = useRef<AutoSelection | null>(null);
  const tapRequest = useRef(0);
  const rankAbort = useRef<AbortController | null>(null);
  const pendingTap = useRef(false);
  const suppressDoubleClick = useRef(false);
  const lastTouchTap = useRef<{ at: number; x: number; y: number; scrollX: number; scrollY: number } | null>(null);
  const [pending, setPending] = useState<{ x: number; y: number } | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  const readVersion = useRef(0);
  const root = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const threads = snapshot?.rev === rev ? snapshot.comments : [];
  const thread = threads.find((t) => t.id === active);
  const openCount = threads.filter((t) => !t.resolved).length;
  useEffect(() => {
    if (!tapSelectPreview) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("tap") === "heuristic") setTapMode("heuristic");
    if (params.get("tapwait") === "200") setTapWait(200);
  }, [tapSelectPreview]);

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
        if (data.rev !== rev) {
          onRevision(data.rev); // Keep the viewed document until an explicit refresh.
          return;
        }
        setSnapshot(data);
        setError("");
      } catch (e) {
        if (!signal?.aborted && version === readVersion.current)
          setError((e as Error).message);
      }
    },
    [rev, onRevision],
  );
  useEffect(() => {
    onComposingChange(active !== null);
    return () => onComposingChange(false);
  }, [active, onComposingChange]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, rev]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let frame = 0;
    let shown: { start: number; end: number } | null = null;
    let held = false;
    let keyHeld = false;
    let touch = window.matchMedia("(pointer: coarse)").matches;
    function hitTesting(enabled: boolean) {
      const button = document.querySelector<HTMLElement>(".comment-selection");
      if (button) button.style.pointerEvents = enabled ? "" : "none";
    }
    function hide() {
      rankAbort.current?.abort();
      rankAbort.current = null;
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      frame = 0;
      shown = null;
      autoSelection.current = null;
      pendingTap.current = false;
      suppressDoubleClick.current = false;
      setPending(null);
      setTapDiagnostic("");
      tapRequest.current++;
      if (dialog.current?.open) return; // Keep the draft's source range.
      hitTesting(false); // Disable synchronously, before React removes the button.
      setSelection(null);
    }
    function position(follow = false) {
      if ((!follow && held) || keyHeld || dialog.current?.open) return;
      const nativeSource = root.current ? sourceSelection(root.current) : null;
      const chosen = autoSelection.current;
      const source = nativeSource && chosen ? chosen.candidates[chosen.index] : nativeSource;
      const range = window.getSelection()?.rangeCount
        ? window.getSelection()!.getRangeAt(0)
        : null;
      const bubble = range
        ? selectionBubble(
            Array.from(range.getClientRects()),
            window.innerWidth,
            window.innerHeight,
            window.matchMedia("(pointer: coarse)").matches,
          )
        : null;
      // Avoid visible fixed/absolute extension controls when the page can observe them.
      const spot =
        bubble?.candidates.find((p) => {
          const element = document.elementFromPoint(
            p.x + bubble.size / 2,
            p.y + bubble.size / 2,
          );
          if (!element || element.closest(".comment-selection")) return true;
          for (
            let el: Element | null = element;
            el && el !== document.body;
            el = el.parentElement
          ) {
            if (["fixed", "absolute"].includes(getComputedStyle(el).position))
              return false;
          }
          return true;
        }) ?? bubble?.candidates[0];
      shown = source && spot && bubble ? source : null;
      setSelection(
        source && spot && bubble
          ? {
              ...source,
              ...spot,
              size: bubble.size,
              text: window.getSelection()?.toString() ?? "",
            }
          : null,
      );
    }
    function settle() {
      clearTimeout(timer);
      if ((!held && !keyHeld) || (touch && shown))
        timer = setTimeout(() => {
          position(touch && !!shown);
          hitTesting(true); // Never leave a settled native adjustment untappable.
        }, touch ? 350 : 140);
    }
    function changed() {
      if (dialog.current?.open) return;
      if (pendingTap.current) { hitTesting(false); setSelection(null); return; }
      const source = root.current ? sourceSelection(root.current) : null;
      if (!source) return hide();
      if (autoSelection.current) { position(true); return; }
      if (touch && shown && source.start < shown.end && source.end > shown.start) {
        // iOS often exposes only selectionchange for native handle drags.
        // Follow overlapping ranges; a disjoint range is a fresh selection.
        hitTesting(false);
        if (!frame) frame = requestAnimationFrame(() => {
          frame = 0;
          position(true);
        });
        settle();
      } else {
        hide();
        settle();
      }
    }
    function beginTouch() {
      touch = true;
      held = true;
      // Native handles cannot reliably be distinguished from a fresh long press
      // until the range changes. Prefer following an existing selection.
      if (shown) {
        hitTesting(false);
        settle();
      } else hide();
    }
    function onBubble(event: Event) {
      return event.target instanceof Element &&
        !!event.target.closest(".comment-selection, .comment-auto-chip");
    }
    function pointerStart(event: PointerEvent) {
      if (event.button !== 0 || onBubble(event)) return;
      if (event.pointerType === "touch") return beginTouch();
      touch = false;
      held = true;
      hide();
    }
    function pointerEnd(event: PointerEvent) {
      if (event.button !== 0 || !held || touch) return;
      held = false;
      if (!suppressDoubleClick.current) position();
    }
    function mouseEnd() {
      if (touch || !held) return;
      held = false;
      if (!suppressDoubleClick.current) position();
    }
    function touchStart(event: TouchEvent) {
      if (onBubble(event)) return;
      beginTouch();
    }
    function touchEnd(event: TouchEvent) {
      if (!held || event.touches.length) return;
      held = false;
      settle();
    }
    function keyboard(event: KeyboardEvent) {
      if (!/^(Arrow|Home$|End$|Page)/.test(event.key)) return;
      touch = false;
      keyHeld = event.type === "keydown";
      hide();
      if (!keyHeld) settle();
    }
    function cancel() {
      held = keyHeld = false;
      hide();
    }
    function pointerCancel(event: PointerEvent) {
      // iOS can hand a long press to native selection before the finger lifts.
      if (event.pointerType === "touch") {
        if (shown) settle();
        else hide();
      } else cancel();
    }
    function touchCancel() {
      held = false;
      if (shown) settle();
      else hide();
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
      hide();
    }
    viewport();
    document.addEventListener("selectionchange", changed);
    document.addEventListener("pointerdown", pointerStart, true);
    document.addEventListener("pointerup", pointerEnd, true);
    document.addEventListener("mouseup", mouseEnd, true);
    document.addEventListener("touchstart", touchStart, { capture: true, passive: true });
    document.addEventListener("touchend", touchEnd, true);
    document.addEventListener("pointercancel", pointerCancel, true);
    document.addEventListener("touchcancel", touchCancel, true);
    document.addEventListener("keydown", keyboard, true);
    document.addEventListener("keyup", keyboard, true);
    window.addEventListener("blur", cancel);
    window.addEventListener("scroll", hide, true);
    window.visualViewport?.addEventListener("resize", viewport);
    window.visualViewport?.addEventListener("scroll", viewport);
    return () => {
      rankAbort.current?.abort();
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      document.removeEventListener("selectionchange", changed);
      document.removeEventListener("pointerdown", pointerStart, true);
      document.removeEventListener("pointerup", pointerEnd, true);
      document.removeEventListener("mouseup", mouseEnd, true);
      document.removeEventListener("touchstart", touchStart, true);
      document.removeEventListener("touchend", touchEnd, true);
      document.removeEventListener("pointercancel", pointerCancel, true);
      document.removeEventListener("touchcancel", touchCancel, true);
      document.removeEventListener("keydown", keyboard, true);
      document.removeEventListener("keyup", keyboard, true);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("scroll", hide, true);
      window.visualViewport?.removeEventListener("resize", viewport);
      window.visualViewport?.removeEventListener("scroll", viewport);
    };
  }, []);

  function chooseAuto(index: number) {
    const state = autoSelection.current;
    if (!state || !root.current) return;
    state.index = index;
    const candidate = state.candidates[index];
    if (selectSourceRange(root.current, candidate.start, candidate.end))
      document.dispatchEvent(new Event("selectionchange"));
  }

  async function tapWord(x: number, y: number) {
    if (!tapSelectPreview || !root.current || dialog.current?.open) return;
    const offset = tapSourceOffset(root.current, x, y, content);
    if (offset === null) return;
    const candidates = tapCandidates(content, offset);
    if (!candidates.length) return;
    const requestId = ++tapRequest.current;
    const baseline = heuristicRanking(candidates);
    const started = performance.now();
    const waitMs = tapMode === "heuristic" ? 200 : tapWait;
    rankAbort.current?.abort();
    pendingTap.current = true;
    autoSelection.current = null;
    setTapDiagnostic("");
    setPending({ x: Math.min(x + 9, window.innerWidth - 24), y: Math.max(4, y - 12) });
    setSelection(null);
    window.getSelection()?.removeAllRanges();

    // Show one selection after at least 200 ms, at most the selected cap.
    // A late reply updates timing only; it never replaces the displayed quote.
    const answer: { current: RankAnswer | null; done: boolean; completedAt: number } = { current: null, done: false, completedAt: 0 };
    const controller = new AbortController();
    rankAbort.current = controller;
    const diagnosticTimeout = setTimeout(() => controller.abort(), 1500);
    const responseDone = fetch("/api/tap-select", {
      method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
      body: JSON.stringify({ context: tapContext(content, offset), candidates, mode: tapMode }),
      signal: controller.signal,
    }).then(async response => response.ok ? response.json() : null)
      .then(data => { answer.current = data; })
      .catch(() => {})
      .finally(() => {
        clearTimeout(diagnosticTimeout);
        answer.done = true;
        answer.completedAt = performance.now();
        if (rankAbort.current === controller) rankAbort.current = null;
      });
    await new Promise(resolve => setTimeout(resolve, 200));
    if (!answer.done && waitMs > 200) {
      let deadlineTimer: ReturnType<typeof setTimeout>;
      await Promise.race([responseDone, new Promise(resolve => {
        deadlineTimer = setTimeout(resolve, Math.max(0, waitMs - (performance.now() - started)));
      })]);
      clearTimeout(deadlineTimer!);
    }
    if (requestId !== tapRequest.current || !pendingTap.current) {
      controller.abort();
      return;
    }
    const onTime = answer.done && answer.completedAt - started <= waitMs;
    const usable = onTime ? answer.current : null;
    const ranking = usable?.ranking;
    const valid = Array.isArray(ranking) && ranking.length === candidates.length &&
      new Set(ranking).size === candidates.length &&
      ranking.every(i => Number.isInteger(i) && i >= 0 && i < candidates.length);
    const finalRanking = valid ? ranking : baseline;
    const timings = (data: RankAnswer | null) => {
      const route = data?.timing?.route_ms, typeSafe = data?.timing?.typesafe_ms;
      const region = data?.timing?.region;
      const outside = Number.isFinite(route) && route! >= 0 ? Math.max(0, Math.round(answer.completedAt - started - route!)) : undefined;
      return [Number.isFinite(route) && route! >= 0 ? `API ${Math.round(route!)}ms` : "",
        Number.isFinite(typeSafe) && typeSafe! >= 0 ? `Jev ${Math.round(typeSafe!)}ms` : "",
        outside === undefined ? "" : `outside ${outside}ms`,
        region && /^[a-z]{3}[0-9]$/u.test(region) ? region : ""].filter(Boolean).join(" · ");
    };
    pendingTap.current = false;
    setPending(null);
    autoSelection.current = {
      candidates, ranking: finalRanking, index: finalRanking[0],
      source: valid ? String(usable?.source ?? "jev") : "heuristic",
      latency: Math.round(performance.now() - started),
      requestId,
    };
    setTapDiagnostic(valid ? timings(usable) : answer.done && onTime ? "request error" : `cap ${waitMs}ms`);
    chooseAuto(finalRanking[0]);
    if (!valid && (!answer.done || !onTime)) void responseDone.then(() => {
      if (requestId !== tapRequest.current || autoSelection.current?.requestId !== requestId) return;
      const elapsed = Math.round(answer.completedAt - started);
      const outcome = answer.current?.timing?.outcome;
      const description = outcome === "jev" ? "late Jev" : outcome === "timeout" ? "late timeout" :
        answer.current ? "late reply" : controller.signal.aborted ? "request aborted" : "request error";
      setTapDiagnostic(`cap ${waitMs}ms · ${description} ${elapsed}ms${timings(answer.current) ? ` · ${timings(answer.current)}` : ""}`);
    });
  }

  function stepAuto(direction: -1 | 1) {
    const state = autoSelection.current;
    if (!state) return;
    const next = adjacentSizeCandidate(state.candidates, state.ranking, state.index, direction);
    if (next !== undefined) chooseAuto(next);
  }

  function setMode(mode: "jev" | "heuristic") {
    setTapMode(mode);
    const url = new URL(window.location.href);
    url.searchParams.set("tap", mode);
    window.history.replaceState(null, "", url);
  }

  function setWait(wait: 200 | 700) {
    setTapWait(wait);
    const url = new URL(window.location.href);
    url.searchParams.set("tapwait", String(wait));
    window.history.replaceState(null, "", url);
  }

  function open(id: string, rect: { left: number; bottom: number }) {
    rankAbort.current?.abort();
    tapRequest.current++; // A late rank must not change an open composer.
    autoSelection.current = null;
    pendingTap.current = false;
    setPending(null);
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
        <p role="alert" className="mb-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {tapSelectPreview && <div className="tap-mode" aria-label="Tap selection controls">Tap select: <button type="button" aria-pressed={tapMode === "jev"} onClick={() => setMode("jev")}>Jev</button><button type="button" aria-pressed={tapMode === "heuristic"} onClick={() => setMode("heuristic")}>Heuristic</button><span className="tap-mode-separator">Jev wait</span><button type="button" aria-label="Wait up to 200 milliseconds" aria-pressed={tapWait === 200} onClick={() => setWait(200)}>200</button><button type="button" aria-label="Wait up to 700 milliseconds" aria-pressed={tapWait === 700} onClick={() => setWait(700)}>700</button></div>}
      <div
        ref={root}
        className={tapSelectPreview ? "tap-select-preview" : undefined}
        onMouseDownCapture={(e) => {
          if (tapSelectPreview && !window.matchMedia("(pointer: coarse)").matches && e.detail >= 2) {
            suppressDoubleClick.current = true;
            e.preventDefault(); // The browser must not flash its native word selection.
          }
        }}
        onDoubleClick={(e) => {
          if (tapSelectPreview && !window.matchMedia("(pointer: coarse)").matches) {
            e.preventDefault();
            suppressDoubleClick.current = false;
            void tapWord(e.clientX, e.clientY);
          }
        }}
        onClick={(e) => {
          if (window.getSelection()?.toString()) { lastTouchTap.current = null; return; }
          const mark = (e.target as HTMLElement).closest<HTMLElement>(
            "[data-comments]",
          );
          if (mark) {
            lastTouchTap.current = null;
            open(mark.dataset.comments!.split(" ")[0], mark.getBoundingClientRect());
            return;
          }
          if (!tapSelectPreview || !window.matchMedia("(pointer: coarse)").matches) return;
          if ((e.target as HTMLElement).closest("a, button, input, textarea, select, [contenteditable], [role='button']")) {
            lastTouchTap.current = null;
            return;
          }
          const now = performance.now();
          const previous = lastTouchTap.current;
          const nearby = previous && now - previous.at <= 350 && now - previous.at >= 0 &&
            Math.hypot(e.clientX - previous.x, e.clientY - previous.y) <= 25 &&
            Math.abs(window.scrollX - previous.scrollX) <= 2 && Math.abs(window.scrollY - previous.scrollY) <= 2;
          lastTouchTap.current = nearby ? null : { at: now, x: e.clientX, y: e.clientY, scrollX: window.scrollX, scrollY: window.scrollY };
          if (nearby) { e.preventDefault(); void tapWord(e.clientX, e.clientY); }
        }}
      >
        <ContentViewer content={content} comments={threads} />
      </div>
      {pending && !active && <span className="tap-pending" role="status" aria-label="Choosing quote" style={{ left: pending.x, top: pending.y }} />}
      {selection && !active && (
        <ToolbarButton
          label="Comment on selection"
          className="comment-selection group"
          style={{
            left: selection.x,
            top: selection.y,
            width: selection.size,
            height: selection.size,
          }}
          onPointerDown={(e) => {
            if (e.pointerType === "mouse") e.preventDefault();
          }}
          onClick={(e) => open("new", e.currentTarget.getBoundingClientRect())}
        >
          <MessageCircle size={14} />
        </ToolbarButton>
      )}
      {selection && !active && autoSelection.current && (() => {
        const state = autoSelection.current;
        const size = state.candidates[state.index].end - state.candidates[state.index].start;
        const smaller = state.ranking.some(i => state.candidates[i].end - state.candidates[i].start < size);
        const larger = state.ranking.some(i => state.candidates[i].end - state.candidates[i].start > size);
        const viewBottom = (window.visualViewport?.offsetTop ?? 0) + (window.visualViewport?.height ?? window.innerHeight);
        return <div className="comment-auto-tools" style={{ left: Math.max(4, Math.min(selection.x - 64, window.innerWidth - 72)), top: Math.max(4, Math.min(selection.y + selection.size + 5, viewBottom - 64)) }}>
          <button type="button" className="comment-auto-chip" aria-label="Smaller selection" disabled={!smaller} onPointerDown={e => { if (e.pointerType === "mouse") e.preventDefault(); }} onClick={() => stepAuto(-1)}><Minus size={13} /></button>
          <button type="button" className="comment-auto-chip" aria-label="Larger selection" disabled={!larger} onPointerDown={e => { if (e.pointerType === "mouse") e.preventDefault(); }} onClick={() => stepAuto(1)}><Plus size={13} /></button>
          <span className="comment-auto-status">{state.source} · {state.latency}ms{tapDiagnostic && <> · {tapDiagnostic}</>}</span>
        </div>;
      })()}
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
            <label className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-2">
              <input
                type="checkbox"
                checked={showResolved}
                onChange={(e) => setShowResolved(e.target.checked)}
              />
              Show resolved
            </label>
          ) : (
            <blockquote className="comment-quote">
              {thread
                ? plainQuote(thread.anchor.exact)
                : (selection?.text ?? "")}
            </blockquote>
          )}
          {thread && (
            <ToolbarButton
              className="comment-icon group"
              label={thread.resolved ? "Reopen thread" : "Resolve thread"}
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
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}{" "}
            <button
              className="underline"
              disabled={busy}
              onClick={() => {
                setSelection(null);
                void load();
              }}
            >
              Refresh comments
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
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    {t.resolved ? "Resolved" : "Open"}
                    {t.location.state === "outdated" ? " · Outdated" : ""}
                  </span>
                  <p className="truncate">{t.messages[0].text}</p>
                </button>
              ))}
            {!threads.filter((t) => showResolved || !t.resolved).length && (
              <p className="text-sm text-zinc-500 dark:text-zinc-400 py-2">
                {threads.length
                  ? "No open comments."
                  : "No comments yet. Select text to start one."}
              </p>
            )}
          </>
        ) : (
          <>
            {thread?.location.state === "outdated" && (
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">
                Outdated · Original quote
              </p>
            )}
            <div className="comment-messages">
              {thread?.messages.map((message, index) => (
                <div key={index} className="mb-3">
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">{message.author}</p>
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
                <Send size={16} />
              </ToolbarButton>
            </form>
          </>
        )}
      </dialog>
    </>
  );
}
