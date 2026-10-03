"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { Check, MessageCircle, MessageSquarePlus, Minus, Plus, RotateCcw, Search, Send, SmilePlus, X } from "lucide-react";
import EmojiPicker, { Theme } from "emoji-picker-react";
import { ContentViewer, type ResponseChange } from "./ContentViewer";
import { ToolbarButton } from "./ToolbarButton";
import { SelectionActionButton } from "./SelectionActionButton";
import { plainQuote, selectionBubble, selectionRevealScroll } from "../lib/comment-presentation";
import { selectSourceRange, sourceSelection, tapSourceOffset } from "../lib/comment-markup";
import { adjacentSizeCandidate, heuristicRanking, tapCandidates, tapContext, type TapCandidate } from "../lib/tap-select";
import type { CommentOperation, LocatedThread } from "../lib/comments";
import { reactionBlocks, type ResponseEntry } from "../lib/responses";
import { DEFAULT_EMOJI } from "../lib/emoji-suggestions";

type Snapshot = { rev: number; content: string; comments: LocatedThread[]; responses: ResponseEntry[] };
type RankAnswer = { ranking: number[]; emojis?: string[]; suggested?: boolean };
type AutoSelection = { candidates: TapCandidate[]; ranking: number[]; index: number; requestId: number };
type Selection = {
  start: number;
  end: number;
  x: number;
  y: number;
  size: number;
  above?: boolean;
  text: string;
};
export function CommentedViewer({
  content,
  rev,
  initialResponses,
  onChange,
  onRevision,
  onComposingChange,
  toolbar,
}: {
  content: string;
  rev: number;
  initialResponses: ResponseEntry[];
  onChange: (content: string, rev: number, responses: ResponseEntry[]) => void;
  onRevision: (rev: number) => void;
  onComposingChange: (composing: boolean) => void;
  toolbar: (commentsButton: ReactNode) => ReactNode;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const selectionStart = selection?.start;
  const selectionEnd = selection?.end;
  const [suggestedEmojis, setSuggestedEmojis] = useState(DEFAULT_EMOJI);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [visualBottom, setVisualBottom] = useState(0);
  const emojiOpenRef = useRef(false);
  const emojiSuggestionKey = useRef("");
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
  const [reactionDrafts, setReactionDrafts] = useState<Record<string, ResponseChange>>({});
  const [reactionBusy, setReactionBusy] = useState(false);
  const [reactionError, setReactionError] = useState("");
  const [reactionTextFocused, setReactionTextFocused] = useState(false);
  const reactionSaveDelay = useRef(0);
  const readVersion = useRef(0);
  const root = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const threads = snapshot?.rev === rev ? snapshot.comments : [];
  const thread = threads.find((t) => t.id === active);
  const openCount = threads.filter((t) => !t.resolved).length;
  const blocks = useMemo(() => reactionBlocks(content), [content]);
  const visibleResponses = snapshot?.rev === rev ? snapshot.responses : initialResponses;
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
        setReactionError("");
      } catch (e) {
        if (!signal?.aborted && version === readVersion.current)
          setError((e as Error).message);
      }
    },
    [rev, onRevision],
  );
  useEffect(() => {
    onComposingChange(active !== null || reactionTextFocused);
    return () => onComposingChange(false);
  }, [active, reactionTextFocused, onComposingChange]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, rev]);

  useEffect(() => {
    if (selectionStart === undefined || selectionEnd === undefined) return;
    const key = `${rev}:${selectionStart}:${selectionEnd}`;
    if (emojiSuggestionKey.current === key) return;
    emojiSuggestionKey.current = key;
    setSuggestedEmojis(DEFAULT_EMOJI);
    const controller = new AbortController();
    void fetch("/api/emoji-suggest", {
      method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
      body: JSON.stringify({ selection: content.slice(selectionStart, selectionEnd), context: tapContext(content, selectionStart) }),
      signal: controller.signal,
    }).then(response => response.ok ? response.json() : null).then(data => {
      if (!controller.signal.aborted && emojiSuggestionKey.current === key &&
        Array.isArray(data?.emojis) && data.emojis.length === 3 && data.emojis.every((emoji: unknown) => typeof emoji === "string"))
        setSuggestedEmojis(data.emojis);
    }).catch(() => {});
    return () => controller.abort();
  }, [selectionStart, selectionEnd, content, rev]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let frame = 0;
    let revealUntil = 0;
    let shown: { start: number; end: number } | null = null;
    let held = false;
    let keyHeld = false;
    let touch = window.matchMedia("(pointer: coarse)").matches;
    function hitTesting(enabled: boolean) {
      document.querySelectorAll<HTMLElement>(".comment-selection, .emoji-selection").forEach(button => {
        button.style.pointerEvents = enabled ? "" : "none";
      });
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
      tapRequest.current++;
      if (dialog.current?.open) return; // Keep the draft's source range.
      emojiOpenRef.current = false;
      setEmojiOpen(false);
      setShowEmojiPicker(false);
      hitTesting(false); // Disable synchronously, before React removes the button.
      setSelection(null);
    }
    function position(follow = false, settled = false) {
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
            window.visualViewport ? {
              left: window.visualViewport.offsetLeft,
              top: window.visualViewport.offsetTop,
              right: window.visualViewport.offsetLeft + window.visualViewport.width,
              bottom: window.visualViewport.offsetTop + window.visualViewport.height,
            } : undefined,
          )
        : null;
      if (source && bubble && !bubble.candidates.length && touch && settled && !held && range && root.current) {
        // Only after settling: expose the end of a long selection with enough
        // clearance for all actions. Mobile bottom padding makes this possible
        // even at the document end. Never fight an active native handle drag.
        const bottom = Math.max(...Array.from(range.getClientRects(), r => r.bottom));
        const viewBottom = (window.visualViewport?.offsetTop ?? 0) + (window.visualViewport?.height ?? window.innerHeight);
        const delta = selectionRevealScroll(bottom, viewBottom);
        if (delta > 0 && window.innerHeight >= 160) {
          revealUntil = performance.now() + 250;
          hitTesting(false);
          setSelection(null);
          window.scrollBy({ top: delta, behavior: "instant" });
          clearTimeout(timer);
          timer = setTimeout(() => position(true), 100);
          return;
        }
      }
      // Avoid visible fixed/absolute extension controls when the page can observe them.
      const spot =
        bubble?.candidates.find((p) => {
          const centers = window.matchMedia("(pointer: coarse)").matches
            ? [p.x + bubble.size / 2, p.x + bubble.size * 1.5 + 4]
            : [p.x + bubble.size / 2];
          return centers.every(x => {
            const element = document.elementFromPoint(x, p.y + bubble.size / 2);
            if (!element || element.closest(".comment-selection, .emoji-selection, .emoji-reactor-bar, .emoji-picker-panel")) return true;
            for (
              let el: Element | null = element;
              el && el !== document.body;
              el = el.parentElement
            ) {
              if (["fixed", "absolute"].includes(getComputedStyle(el).position))
                return false;
            }
            return true;
          });
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
          position(touch && !!shown, true);
          hitTesting(true); // Never leave a settled native adjustment untappable.
        }, touch ? 350 : 140);
    }
    function changed() {
      if (dialog.current?.open || emojiOpenRef.current) return;
      if (pendingTap.current) { hitTesting(false); setSelection(null); return; }
      const source = root.current ? sourceSelection(root.current) : null;
      if (!source) return hide();
      if (autoSelection.current) { position(true, true); return; }
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
        !!event.target.closest(".comment-selection, .emoji-selection, .emoji-reactor-bar, .emoji-picker-panel, .comment-auto-chip");
    }
    function pointerStart(event: PointerEvent) {
      if (event.button !== 0 || onBubble(event)) return;
      if (emojiOpenRef.current) {
        window.getSelection()?.removeAllRanges();
        hide();
        return;
      }
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
      if (onBubble(event) || !held || event.touches.length) return;
      held = false;
      settle();
    }
    function keyboard(event: KeyboardEvent) {
      if (event.key === "Escape" && emojiOpenRef.current) {
        emojiOpenRef.current = false;
        setEmojiOpen(false);
        setShowEmojiPicker(false);
        return;
      }
      if (emojiOpenRef.current && event.target instanceof Element && event.target.closest(".emoji-picker-panel")) return;
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
      const bottom = view ? view.offsetTop + view.height : window.innerHeight;
      setVisualBottom(bottom);
      dialog.current?.style.setProperty(
        "--comment-bottom",
        `${view ? Math.max(0, window.innerHeight - view.height - view.offsetTop) : 0}px`,
      );
      dialog.current?.style.setProperty(
        "--comment-viewport",
        `${view?.height ?? window.innerHeight}px`,
      );
      if (!emojiOpenRef.current && performance.now() >= revealUntil) hide();
    }
    function scroll() {
      if (performance.now() < revealUntil) return;
      // Focusing and scrolling inside the picker can move the visual viewport.
      // Outside taps still dismiss the bar through pointerStart.
      if (!emojiOpenRef.current) hide();
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
    window.addEventListener("scroll", scroll, true);
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
      window.removeEventListener("scroll", scroll, true);
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
    if (!root.current || dialog.current?.open) return;
    const offset = tapSourceOffset(root.current, x, y, content);
    if (offset === null) return;
    const candidates = tapCandidates(content, offset);
    if (!candidates.length) return;
    const requestId = ++tapRequest.current;
    const baseline = heuristicRanking(candidates);
    const started = performance.now();
    const waitMs = 700;
    rankAbort.current?.abort();
    pendingTap.current = true;
    autoSelection.current = null;
    setPending({ x: Math.min(x + 9, window.innerWidth - 24), y: Math.max(4, y - 12) });
    setSelection(null);
    window.getSelection()?.removeAllRanges();

    // Show one selection after at least 200 ms, at most 700 ms.
    // A late reply never replaces the displayed quote.
    const answer: { current: RankAnswer | null; done: boolean; completedAt: number } = { current: null, done: false, completedAt: 0 };
    const controller = new AbortController();
    rankAbort.current = controller;
    const responseDone = fetch("/api/tap-select", {
      method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
      body: JSON.stringify({ context: tapContext(content, offset), candidates }),
      signal: controller.signal,
    }).then(async response => response.ok ? response.json() : null)
      .then(data => { answer.current = data; })
      .catch(() => {})
      .finally(() => {
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
    const picked = candidates[finalRanking[0]];
    if (usable?.suggested && usable.emojis?.length === 3) {
      emojiSuggestionKey.current = `${rev}:${picked.start}:${picked.end}`;
      setSuggestedEmojis(usable.emojis);
    } else emojiSuggestionKey.current = "";
    pendingTap.current = false;
    setPending(null);
    autoSelection.current = {
      candidates, ranking: finalRanking, index: finalRanking[0],
      requestId,
    };
    chooseAuto(finalRanking[0]);
    if (!valid) controller.abort();
  }

  function stepAuto(direction: -1 | 1) {
    const state = autoSelection.current;
    if (!state) return;
    const next = adjacentSizeCandidate(state.candidates, state.ranking, state.index, direction);
    if (next !== undefined) chooseAuto(next);
  }

  function open(id: string, rect: { left: number; bottom: number }) {
    emojiOpenRef.current = false;
    setEmojiOpen(false);
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
      setShowEmojiPicker(false);
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
      onChange(data.content, data.rev, data.responses);
      setDraft("");
      setSelection(null);
      emojiOpenRef.current = false;
      setEmojiOpen(false);
      setShowEmojiPicker(false);
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
  function sendEmoji(emoji: string) {
    if (!selection || busy) return;
    void submit({ action: "create", start: selection.start, end: selection.end, text: emoji });
  }
  const writeResponses = useCallback(async (changes: ResponseChange[]) => {
    if (reactionBusy || !snapshot || snapshot.rev !== rev) return;
    setReactionBusy(true);
    setReactionError("");
    try {
      const response = await fetch("/api/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ if_rev: snapshot.rev, changes }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 409 && Number.isSafeInteger(data.rev)) onRevision(data.rev);
        throw new Error(data.error);
      }
      setSnapshot({ ...snapshot, rev: data.rev, responses: data.responses });
      onChange(content, data.rev, data.responses);
      for (const change of changes) setReactionDrafts(previous => {
        const next = { ...previous };
        if (next[change.block_id] === change) delete next[change.block_id];
        return next;
      });
    } catch (error) {
      setReactionError((error as Error).message);
    } finally {
      setReactionBusy(false);
    }
  }, [reactionBusy, snapshot, rev, onRevision, onChange, content]);
  function changeReaction(change: ResponseChange, persist: boolean) {
    setReactionDrafts(previous => ({ ...previous, [change.block_id]: change }));
    reactionSaveDelay.current = persist ? 0 : 350;
    setReactionError("");
  }
  useEffect(() => {
    if (reactionBusy || reactionError || !snapshot || snapshot.rev !== rev) return;
    const pending = blocks.find(block => reactionDrafts[block.id]);
    if (!pending) return;
    const timer = setTimeout(() => void writeResponses([reactionDrafts[pending.id]]), reactionSaveDelay.current);
    return () => clearTimeout(timer);
  }, [blocks, reactionBusy, reactionError, reactionDrafts, snapshot, rev, writeResponses]);
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
      <div
        ref={root}
        className="tap-select"
        onMouseDownCapture={(e) => {
          if ((e.target as HTMLElement).closest(".metadata-callout")) return;
          if (!window.matchMedia("(pointer: coarse)").matches && e.detail >= 2) {
            suppressDoubleClick.current = true;
            e.preventDefault(); // The browser must not flash its native word selection.
          }
        }}
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).closest(".metadata-callout")) return;
          if (!window.matchMedia("(pointer: coarse)").matches) {
            e.preventDefault();
            suppressDoubleClick.current = false;
            void tapWord(e.clientX, e.clientY);
          }
        }}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest(".metadata-callout")) { lastTouchTap.current = null; return; }
          if (window.getSelection()?.toString()) { lastTouchTap.current = null; return; }
          const mark = (e.target as HTMLElement).closest<HTMLElement>(
            "[data-comments]",
          );
          if (mark) {
            lastTouchTap.current = null;
            open(mark.dataset.comments!.split(" ")[0], mark.getBoundingClientRect());
            return;
          }
          if (!window.matchMedia("(pointer: coarse)").matches) return;
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
        <ContentViewer content={content} comments={threads} responses={visibleResponses} drafts={reactionDrafts} onReaction={changeReaction} onTextFocus={setReactionTextFocused} busy={!snapshot || snapshot.rev !== rev} />
      </div>
      {blocks.length > 0 && <div className="reaction-status">
        <span role="status">{reactionError ? "Choices not saved" : reactionBusy || Object.keys(reactionDrafts).length ? "Saving choices…" : "Choices saved as drafts. Respond in chat."}</span>
        {reactionError && <p role="alert">{reactionError} <button type="button" onClick={() => void load()}>Refresh choices</button></p>}
      </div>}
      {pending && !active && <span className="tap-pending" role="status" aria-label="Choosing quote" style={{ left: pending.x, top: pending.y }} />}
      {selection && !active && !emojiOpen && (
        <SelectionActionButton
          label="Comment on selection"
          className="comment-selection group"
          style={{
            left: selection.x,
            top: selection.y,
            width: selection.size,
            height: selection.size,
          }}
          onPointerDown={(e) => {
            e.preventDefault();
          }}
          onClick={(e) => open("new", e.currentTarget.getBoundingClientRect())}
        >
          <MessageSquarePlus size={15} />
        </SelectionActionButton>
      )}
      {selection && !active && !emojiOpen && <SelectionActionButton
        label="React to selection"
        className="emoji-selection group"
        aria-expanded={emojiOpen}
        style={{
          left: window.matchMedia("(pointer: coarse)").matches || selection.x + selection.size * 2 + 4 <= window.innerWidth - 4
            ? selection.x + selection.size + 4 : selection.x - selection.size - 4,
          top: selection.y,
          width: selection.size,
          height: selection.size,
        }}
        onPointerDown={e => {
          if (e.pointerType === "mouse") emojiOpenRef.current = true;
          e.preventDefault();
        }}
        onClick={() => {
          const next = !emojiOpen;
          emojiOpenRef.current = next;
          setEmojiOpen(next);
          setShowEmojiPicker(false);
          setError("");
        }}
      ><SmilePlus size={15} /></SelectionActionButton>}
      {selection && !active && emojiOpen && (() => {
        const viewBottom = visualBottom || window.innerHeight;
        const barTop = selection.above ? selection.y - 59
          : selection.y + selection.size + 56 < viewBottom
            ? selection.y + selection.size + 5 : Math.max(4, selection.y - 56);
        const pickerWidth = Math.min(320, window.innerWidth - 16);
        const pickerHeight = Math.min(310, Math.max(180, viewBottom - 16));
        const pickerTop = barTop + pickerHeight + 56 < viewBottom
          ? barTop + 56 : Math.max(8, Math.min(barTop - pickerHeight - 5, viewBottom - pickerHeight - 8));
        return <>
          <div className="emoji-reactor-bar" role="toolbar" aria-label="Emoji reactions" style={{ left: Math.max(4, Math.min(selection.x, window.innerWidth - 208)), top: barTop }}>
            {suggestedEmojis.map((emoji, index) => <button type="button" key={`${index}-${emoji}`} disabled={busy} aria-label={`React with ${emoji}`} onClick={() => sendEmoji(emoji)}>{emoji}</button>)}
            <button type="button" aria-label="Search emoji" aria-expanded={showEmojiPicker} onClick={() => setShowEmojiPicker(value => !value)}><Search size={18} /></button>
          </div>
          {showEmojiPicker && <div className="emoji-picker-panel" style={{ left: Math.max(8, Math.min(selection.x, window.innerWidth - pickerWidth - 8)), top: pickerTop, width: pickerWidth }}>
            <EmojiPicker theme={Theme.AUTO} width="100%" height={pickerHeight} autoFocusSearch onEmojiClick={data => sendEmoji(data.emoji)} />
          </div>}
          {error && <p className="emoji-reactor-error" role="alert" style={{
            left: selection.above !== undefined ? selection.x : Math.max(8, Math.min(selection.x, window.innerWidth - 280)),
            top: selection.above !== undefined ? selection.y : barTop + 58,
            maxWidth: selection.above !== undefined ? 208 : undefined,
            maxHeight: selection.above !== undefined ? 36 : undefined,
            overflow: "auto",
          }}>{error}</p>}
        </>;
      })()}
      {selection && !active && !emojiOpen && autoSelection.current && (() => {
        const state = autoSelection.current;
        const size = state.candidates[state.index].end - state.candidates[state.index].start;
        const smaller = state.ranking.some(i => state.candidates[i].end - state.candidates[i].start < size);
        const larger = state.ranking.some(i => state.candidates[i].end - state.candidates[i].start > size);
        const viewBottom = (window.visualViewport?.offsetTop ?? 0) + (window.visualViewport?.height ?? window.innerHeight);
        return <div className="comment-auto-tools" style={{ left: selection.above !== undefined ? selection.x : Math.max(4, Math.min(selection.x - 64, window.innerWidth - 72)), top: Math.max(4, Math.min(selection.above ? selection.y - 29 : selection.y + selection.size + 5, viewBottom - 64)) }}>
          <button type="button" className="comment-auto-chip" aria-label="Smaller selection" disabled={!smaller} onPointerDown={e => { if (e.pointerType === "mouse") e.preventDefault(); }} onClick={() => stepAuto(-1)}><Minus size={13} /></button>
          <button type="button" className="comment-auto-chip" aria-label="Larger selection" disabled={!larger} onPointerDown={e => { if (e.pointerType === "mouse") e.preventDefault(); }} onClick={() => stepAuto(1)}><Plus size={13} /></button>
        </div>;
      })()}
      <dialog
        ref={dialog}
        className="comment-sheet"
        aria-label={active === "list" ? "Comments" : "Comment thread"}
        onClose={() => {
          setActive(null);
          setSelection(null);
          setShowEmojiPicker(false);
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
