"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { getStroke } from "perfect-freehand";
import { Check, ClipboardCopy, Eraser, Hand, Undo2 } from "lucide-react";
import {
  INK_COLORS, classifyStroke, lineBoxes, project, toFrame, unionBox,
  type Box, type InkColor, type InkOperation, type LocatedStroke, type WordBox,
} from "../lib/ink";
import { apiErrorMessage, readJsonSafe } from "../lib/noteClient";
import { useNoteSession } from "./NoteSession";

export type InkSnapshot = { ink_rev: number; strokes: LocatedStroke[] };
type Point = { x: number; y: number; p: number };
type AddPayload = Extract<InkOperation, { action: "add" }>["stroke"];
type UndoEntry = { type: "add"; id: string } | { type: "remove"; payload: AddPayload };

const COLOR_VALUE: Record<InkColor, string> = { ink: "var(--foreground)", red: "#d23b2a", blue: "#2563eb", green: "#16803c" };
const COLOR_LABEL: Record<InkColor, string> = { ink: "Ink", red: "Red", blue: "Blue", green: "Green" };
const PEN_WIDTH = 3.5;
/** Regions that own their own pointer input (images, embeds) are never drawn over. */
const SKIP = ".ink-toolbar, .note-image, .note-image-placeholder, .note-embed, .note-embed-dialog, .reaction-ask, .reaction-task-control";

function spans(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>("[data-source-start]")].filter(span => !span.closest(SKIP));
}

function toLayer(root: HTMLElement, rect: DOMRect | Box): Box {
  const origin = root.getBoundingClientRect();
  return { left: rect.left - origin.left, top: rect.top - origin.top, right: rect.right - origin.left, bottom: rect.bottom - origin.top };
}

/** Client rects of a raw-source range, one span at a time (a single Range would add whole block boxes). */
export function sourceRangeRects(root: HTMLElement, start: number, end: number): Box[] {
  const rects: Box[] = [];
  for (const span of spans(root)) {
    const from = Number(span.dataset.sourceStart), to = Number(span.dataset.sourceEnd);
    const text = span.firstChild;
    if (!(to > start && from < end) || !text || text.nodeType !== Node.TEXT_NODE) continue;
    const length = text.textContent?.length ?? 0;
    const exact = span.dataset.sourceExact === "true";
    const range = document.createRange();
    range.setStart(text, exact ? Math.max(0, Math.min(length, start - from)) : 0);
    range.setEnd(text, exact ? Math.max(0, Math.min(length, end - from)) : length);
    for (const rect of range.getClientRects()) if (rect.width > 0.5 && rect.height > 0.5) rects.push(toLayer(root, rect));
  }
  return rects;
}

const WORD = /[\p{L}\p{N}]+(?:['’.\-][\p{L}\p{N}]+)*/gu;

/** Words near a region (layer space) with their raw-source ranges. */
function wordsNear(root: HTMLElement, region: Box): WordBox[] {
  const words: WordBox[] = [];
  const origin = root.getBoundingClientRect();
  for (const span of spans(root)) {
    const r = span.getBoundingClientRect();
    const box = { left: r.left - origin.left, top: r.top - origin.top, right: r.right - origin.left, bottom: r.bottom - origin.top };
    if (box.right < region.left || box.left > region.right || box.bottom < region.top || box.top > region.bottom) continue;
    const text = span.firstChild;
    if (!text || text.nodeType !== Node.TEXT_NODE) continue;
    const from = Number(span.dataset.sourceStart), to = Number(span.dataset.sourceEnd);
    const exact = span.dataset.sourceExact === "true";
    for (const match of (text.textContent ?? "").matchAll(WORD)) {
      const range = document.createRange();
      range.setStart(text, match.index);
      range.setEnd(text, match.index + match[0].length);
      const rects = [...range.getClientRects()].filter(rect => rect.width > 0.5);
      if (!rects.length) continue;
      const first = rects[0];
      words.push({
        left: first.left - origin.left, top: first.top - origin.top, right: first.right - origin.left, bottom: first.bottom - origin.top,
        start: exact ? from + match.index : from, end: exact ? from + match.index + match[0].length : to,
      });
    }
  }
  return words;
}

function outline(points: Point[], width: number, pen: boolean) {
  const outlinePoints = getStroke(points.map(p => [p.x, p.y, p.p]), {
    size: width * 1.6, thinning: pen ? 0.55 : 0.4, smoothing: 0.5, streamline: 0.45, simulatePressure: !pen, last: true,
  });
  if (outlinePoints.length < 2) return "";
  const d = outlinePoints.reduce((acc, [x0, y0], i, arr) => {
    const [x1, y1] = arr[(i + 1) % arr.length];
    acc.push(x0.toFixed(1), y0.toFixed(1), ((x0 + x1) / 2).toFixed(1), ((y0 + y1) / 2).toFixed(1));
    return acc;
  }, ["M", outlinePoints[0][0].toFixed(1), outlinePoints[0][1].toFixed(1), "Q"]);
  return d.join(" ") + " Z";
}

function simplify(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const point of points) {
    const last = out.at(-1);
    if (!last || Math.hypot(point.x - last.x, point.y - last.y) >= 1.5) out.push(point);
  }
  if (points.length && out.at(-1) !== points.at(-1)) out.push(points.at(-1)!);
  const step = Math.ceil(out.length / 1400);
  return step > 1 ? out.filter((_, i) => i % step === 0 || i === out.length - 1) : out;
}

const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 20);

type Rendered = { id: string; color: InkColor; d: string; points: Point[]; width: number; kind: string };

export default function InkLayer({ root, content, drawing, snapshot, onSnapshot, onDone }: {
  root: HTMLElement;
  content: string;
  drawing: boolean;
  snapshot: InkSnapshot;
  onSnapshot: (snapshot: InkSnapshot) => void;
  onDone: () => void;
}) {
  const { noteFetch } = useNoteSession();
  const [color, setColor] = useState<InkColor>("red");
  const [eraser, setEraser] = useState(false);
  const [fingerDraws, setFingerDraws] = useState(true);
  const penSeen = useRef(false);
  const [rendered, setRendered] = useState<Rendered[]>([]);
  const [live, setLive] = useState<Rendered | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [layout, setLayout] = useState(0);
  const [status, setStatus] = useState("");
  const [undo, setUndo] = useState<UndoEntry[]>([]);
  const state = useRef({ snapshot, color, eraser, fingerDraws, rendered });
  useLayoutEffect(() => { state.current = { snapshot, color, eraser, fingerDraws, rendered }; });
  const queue = useRef<Promise<void>>(Promise.resolve());
  const saving = useRef<{ count: number; rev: number; local: LocatedStroke[] }>({ count: 0, rev: 0, local: [] });

  /* Re-project whenever the text can have moved: resize/rotation, fonts, images, content. */
  useEffect(() => {
    let frame = 0;
    const bump = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => setLayout(n => n + 1)); };
    const observer = new ResizeObserver(bump);
    observer.observe(root);
    const prose = root.querySelector(".prose");
    if (prose) observer.observe(prose);
    window.addEventListener("resize", bump);
    window.addEventListener("orientationchange", bump);
    void document.fonts?.ready.then(bump);
    root.addEventListener("load", bump, true);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", bump);
      window.removeEventListener("orientationchange", bump);
      root.removeEventListener("load", bump, true);
    };
  }, [root]);

  useLayoutEffect(() => {
    // Projection reads the committed DOM's text boxes, so it has to run after layout.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- measured from layout, not derivable during render
    setSize({ w: root.scrollWidth, h: root.scrollHeight });
    const next: Rendered[] = [];
    for (const stroke of snapshot.strokes) {
      if (stroke.location.state !== "attached") continue;
      const lines = lineBoxes(sourceRangeRects(root, stroke.location.start, stroke.location.end));
      for (const [index, run] of project(stroke, lines).entries())
        next.push({ id: stroke.id, color: stroke.color, d: outline(run, stroke.width, stroke.pen), points: run, width: stroke.width, kind: stroke.kind + (index ? `-${index}` : "") });
    }
    setRendered(next);
  }, [root, snapshot, layout, content]);

  const send = useCallback((operations: InkOperation[], optimistic?: (strokes: LocatedStroke[]) => LocatedStroke[]) => {
    // Strokes can land faster than a round trip, so the queue tracks its own truth rather than
    // the last rendered snapshot: `local` holds server strokes plus everything still pending,
    // and each request sends the rev the previous response returned.
    const pending = saving.current;
    if (!pending.count) { pending.local = state.current.snapshot.strokes; pending.rev = state.current.snapshot.ink_rev; }
    pending.count += 1;
    if (optimistic) {
      pending.local = optimistic(pending.local);
      onSnapshot({ ink_rev: pending.rev, strokes: pending.local });
    }
    queue.current = queue.current.then(async () => {
      const response = await noteFetch("/api/annotations", {
        method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ if_ink_rev: pending.rev, operations }),
      });
      const data = await readJsonSafe(response);
      if (response.ok) {
        pending.rev = data.ink_rev as number;
        setStatus("Ink saved");
        // Mid-queue responses would drop still-pending strokes; only the last one is authoritative.
        if (pending.count === 1) onSnapshot({ ink_rev: pending.rev, strokes: data.strokes as LocatedStroke[] });
        return;
      }
      setStatus(apiErrorMessage(data, "Couldn't save ink."));
      const reload = await noteFetch("/api/annotations", { cache: "no-store" });
      const fresh = await readJsonSafe(reload);
      if (reload.ok) {
        pending.rev = fresh.ink_rev as number;
        pending.local = fresh.strokes as LocatedStroke[];
        onSnapshot({ ink_rev: pending.rev, strokes: pending.local });
      }
    }).catch(() => setStatus("Couldn't save ink.")).finally(() => { pending.count -= 1; });
  }, [noteFetch, onSnapshot]);

  const addPayload = useCallback((stroke: LocatedStroke): AddPayload | null => {
    if (stroke.location.state !== "attached") return null;
    const { anchor: _anchor, created_at: _created, location, ...rest } = stroke;
    void _anchor; void _created;
    return { ...rest, start: location.start, end: location.end, quote: content.slice(location.start, location.end) };
  }, [content]);

  const add = useCallback((payload: AddPayload) => {
    send([{ action: "add", stroke: payload }], strokes => [...strokes, {
      ...payload, anchor: { exact: payload.quote, prefix: "", suffix: "", position: { start: payload.start, end: payload.end } }, created_at: Date.now(),
      location: { state: "attached", start: payload.start, end: payload.end, text: payload.quote },
    } as LocatedStroke]);
  }, [send]);

  const remove = useCallback((id: string) => send([{ action: "remove", id }], strokes => strokes.filter(s => s.id !== id)), [send]);

  const finish = useCallback((points: Point[], pen: boolean) => {
    const pts = simplify(points);
    const bounds = unionBox(pts.map(p => ({ left: p.x, top: p.y, right: p.x, bottom: p.y })))!;
    if (pts.length < 2 || Math.hypot(bounds.right - bounds.left, bounds.bottom - bounds.top) < 4) return;
    const pad = 60;
    const words = wordsNear(root, { left: bounds.left - pad, top: bounds.top - pad, right: bounds.right + pad, bottom: bounds.bottom + pad });
    const result = classifyStroke(pts, words.length ? words : wordsNear(root, { left: -1e5, top: bounds.top - 400, right: 1e5, bottom: bounds.bottom + 400 }));
    if (!result) { setStatus("Draw over the note's text."); return; }
    const start = Math.min(...result.words.map(w => w.start)), end = Math.max(...result.words.map(w => w.end));
    const lines = lineBoxes(sourceRangeRects(root, start, end));
    const box = unionBox(lines) ?? unionBox(result.words)!;
    const framed = toFrame(pts, result.kind, box);
    const payload: AddPayload = {
      id: newId(), kind: result.kind, color: state.current.color, width: PEN_WIDTH, start, end, quote: content.slice(start, end),
      frame: framed.frame, box: { w: box.right - box.left, h: box.bottom - box.top, lines: Math.max(1, lines.length) }, points: framed.points, pen,
    };
    add(payload);
    setUndo(stack => [...stack.slice(-49), { type: "add", id: payload.id }]);
    setStatus(`${result.kind === "freehand" ? "Mark" : result.kind[0].toUpperCase() + result.kind.slice(1)} on “${payload.quote.slice(0, 60)}”`);
  }, [root, content, add]);

  const eraseAt = useCallback((x: number, y: number) => {
    const hit = state.current.rendered.find(r => r.points.some(p => Math.hypot(p.x - x, p.y - y) <= r.width + 10));
    if (!hit) return;
    const stroke = state.current.snapshot.strokes.find(s => s.id === hit.id);
    const payload = stroke && addPayload(stroke);
    remove(hit.id);
    if (payload) setUndo(stack => [...stack.slice(-49), { type: "remove", payload }]);
  }, [addPayload, remove]);

  /* Pointer input. Draw mode off: nothing is attached, and the layer ignores hit testing. */
  useEffect(() => {
    if (!drawing) return;
    let active: { id: number; pen: boolean; points: Point[] } | null = null;
    let suppressUntil = 0;
    let frame = 0;
    const local = (e: PointerEvent): Point => {
      const origin = root.getBoundingClientRect();
      return { x: e.clientX - origin.left, y: e.clientY - origin.top, p: e.pointerType === "pen" && e.pressure > 0 ? e.pressure : 0.5 };
    };
    const draws = (e: PointerEvent) => e.pointerType === "pen" || (e.pointerType === "mouse" && e.button === 0) || (e.pointerType === "touch" && state.current.fingerDraws);
    function down(e: PointerEvent) {
      if (!e.isPrimary || (e.target as Element).closest?.(SKIP)) return;
      if (e.pointerType === "pen" && !penSeen.current) {
        // Like iPadOS "Only Draw with Apple Pencil": once a pen shows up, fingers scroll again.
        penSeen.current = true;
        state.current.fingerDraws = false;
        setFingerDraws(false);
      }
      if (!draws(e)) return;
      e.preventDefault();
      try { root.setPointerCapture(e.pointerId); } catch { /* synthetic or already released */ }
      window.getSelection()?.removeAllRanges();
      active = { id: e.pointerId, pen: e.pointerType === "pen", points: [local(e)] };
      if (state.current.eraser) eraseAt(active.points[0].x, active.points[0].y);
    }
    function move(e: PointerEvent) {
      if (!active || e.pointerId !== active.id) return;
      e.preventDefault();
      const events = e.getCoalescedEvents?.() ?? [];
      for (const event of events.length ? events : [e]) active.points.push(local(event));
      if (state.current.eraser) { const p = active.points.at(-1)!; eraseAt(p.x, p.y); return; }
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0;
        if (active) setLive({ id: "live", color: state.current.color, d: outline(active.points, PEN_WIDTH, active.pen), points: [], width: PEN_WIDTH, kind: "live" });
      });
    }
    function up(e: PointerEvent) {
      if (!active || e.pointerId !== active.id) return;
      const done = active;
      active = null;
      suppressUntil = performance.now() + 450;
      cancelAnimationFrame(frame);
      frame = 0;
      setLive(null);
      if (!state.current.eraser) finish(done.points, done.pen);
    }
    function cancel(e: PointerEvent) {
      if (!active || e.pointerId !== active.id) return;
      active = null;
      setLive(null);
    }
    function click(e: MouseEvent) {
      // A stroke must never become a tap-select, a link open or a comment-mark tap.
      if (performance.now() < suppressUntil && !(e.target as Element).closest?.(".ink-toolbar")) { e.preventDefault(); e.stopPropagation(); }
    }
    function touchStart(e: TouchEvent) {
      // iPadOS scrolls and long-press-selects with Pencil too; claim stylus touches only, so a
      // finger can still scroll, pinch, double-tap or long-press while draw mode is on.
      if ([...e.changedTouches].some(t => (t as Touch & { touchType?: string }).touchType === "stylus")) e.preventDefault();
    }
    const select = (e: Event) => { if (active) e.preventDefault(); };
    root.addEventListener("pointerdown", down, true);
    root.addEventListener("pointermove", move, true);
    root.addEventListener("pointerup", up, true);
    root.addEventListener("pointercancel", cancel, true);
    root.addEventListener("click", click, true);
    root.addEventListener("dblclick", click, true);
    root.addEventListener("touchstart", touchStart, { capture: true, passive: false });
    root.addEventListener("selectstart", select, true);
    return () => {
      cancelAnimationFrame(frame);
      root.removeEventListener("pointerdown", down, true);
      root.removeEventListener("pointermove", move, true);
      root.removeEventListener("pointerup", up, true);
      root.removeEventListener("pointercancel", cancel, true);
      root.removeEventListener("click", click, true);
      root.removeEventListener("dblclick", click, true);
      root.removeEventListener("touchstart", touchStart, true);
      root.removeEventListener("selectstart", select, true);
    };
  }, [drawing, root, finish, eraseAt]);

  useEffect(() => {
    root.classList.toggle("ink-drawing", drawing);
    root.classList.toggle("ink-finger", drawing && fingerDraws);
    return () => root.classList.remove("ink-drawing", "ink-finger");
  }, [root, drawing, fingerDraws]);

  function undoLast() {
    const last = undo.at(-1);
    if (!last) return;
    setUndo(stack => stack.slice(0, -1));
    if (last.type === "add") remove(last.id);
    else add(last.payload);
  }

  async function copyForAgent() {
    await queue.current;
    const response = await noteFetch("/api/annotations?format=markdown", { cache: "no-store" });
    if (!response.ok) { setStatus("Couldn't read annotations."); return; }
    try { await navigator.clipboard.writeText(await response.text()); setStatus("Annotations copied"); } catch { setStatus("Couldn't copy."); }
  }

  return <>
    <svg className="ink-layer" width={size.w} height={size.h} aria-hidden="true" data-ink-count={snapshot.strokes.length}>
      {rendered.map((r, i) => <path key={`${r.id}-${i}`} d={r.d} fill={COLOR_VALUE[r.color]} data-stroke-id={r.id} data-kind={r.kind} />)}
      {live && <path d={live.d} fill={COLOR_VALUE[live.color]} data-live="true" />}
    </svg>
    {drawing && <div className="ink-toolbar" role="toolbar" aria-label="Ink">
      {INK_COLORS.map(c => <button key={c} type="button" className="ink-swatch" aria-label={`${COLOR_LABEL[c]} pen`} aria-pressed={!eraser && color === c}
        style={{ color: COLOR_VALUE[c] }} onClick={() => { setColor(c); setEraser(false); }}><span aria-hidden="true" /></button>)}
      <button type="button" className="ink-tool" aria-label="Eraser" aria-pressed={eraser} onClick={() => setEraser(v => !v)}><Eraser size={18} /></button>
      <button type="button" className="ink-tool" aria-label="Undo" disabled={!undo.length} onClick={undoLast}><Undo2 size={18} /></button>
      <button type="button" className="ink-tool" role="switch" aria-label="Finger draws" aria-checked={fingerDraws}
        title="When off, only a pen draws and fingers scroll"
        onClick={() => setFingerDraws(v => !v)}><Hand size={18} /></button>
      <button type="button" className="ink-tool" aria-label="Copy annotations for an agent" onClick={() => void copyForAgent()}><ClipboardCopy size={18} /></button>
      <button type="button" className="ink-tool ink-done" aria-label="Done drawing" onClick={onDone}><Check size={18} /></button>
      <span className="sr-only" role="status">{status}</span>
    </div>}
  </>;
}
