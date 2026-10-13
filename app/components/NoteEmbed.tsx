"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useAssetUrls } from "./NoteImage";
import {
  EMBED_DEFAULT_HEIGHT,
  EMBED_HEARTBEAT_MS,
  EMBED_ID_PATTERN,
  EMBED_MAX_HEIGHT,
  EMBED_MOBILE_VIEWPORTS,
  EMBED_OFFSCREEN_STOP_MS,
  EMBED_SCHEME,
  EMBED_STALL_MS,
  clampHeight,
  messageBudget,
  parseEmbedMessage,
  parseEmbedParams,
  presignedExpiry,
  type EmbedParams,
} from "../lib/embedPolicy";

const COLOR_TOKENS: [string, string][] = [
  ["--paper", "var(--background)"],
  ["--ink-text", "var(--foreground)"],
  ["--muted", "var(--muted)"],
  ["--rule", "var(--hairline)"],
  // Links are ink now, so the highlight comes from the slab: neither ink nor the reserved accent.
  ["--accent-ink", "var(--slab)"],
  // Kept under its published name; "new" is the orange accent, which embeds must not use.
  ["--red-new", "var(--accent-new)"],
  ["--code-paper", "var(--code-background)"],
  ["--code-ink", "var(--code-foreground)"],
];
const TYPE_TOKENS = ["--text-xs", "--text-sm", "--text-base", "--text-lg", "--text-xl", "--text-2xl"];
const SPACE_TOKENS = { "--space-1": "4px", "--space-2": "8px", "--space-3": "12px", "--space-4": "16px", "--space-5": "24px", "--space-6": "32px" };
const FONT_TOKENS = {
  "--font-sans": '"Geist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  "--font-mono": '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
};
const MOBILE = "(max-width: 640px)";
const DARK = "(prefers-color-scheme: dark)";

/** Marker's live tokens, resolved to plain values, under the names docs/embeds.md promises. */
function embedTheme(): { theme: Record<string, string>; mode: "light" | "dark" } {
  const theme: Record<string, string> = { ...FONT_TOKENS, ...SPACE_TOKENS };
  const probe = document.createElement("span");
  probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none";
  document.body.appendChild(probe);
  try {
    for (const [name, value] of COLOR_TOKENS) {
      probe.style.color = value;
      theme[name] = getComputedStyle(probe).color;
    }
  } finally {
    probe.remove();
  }
  const root = getComputedStyle(document.documentElement);
  const rem = parseFloat(root.fontSize) || 16;
  for (const name of TYPE_TOKENS) {
    const value = root.getPropertyValue(name).trim();
    if (value.endsWith("rem")) theme[name] = `${parseFloat(value) * rem}px`;
  }
  return { theme, mode: window.matchMedia(DARK).matches ? "dark" : "light" };
}

function maxHeight(): number {
  return window.matchMedia(MOBILE).matches ? Math.min(EMBED_MAX_HEIGHT, window.innerHeight * EMBED_MOBILE_VIEWPORTS) : EMBED_MAX_HEIGHT;
}

function reducedMotion(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches || Boolean(connection?.saveData);
}

function openLink(url: string) {
  const host = new URL(url).host;
  if (window.confirm(`This embed wants to open a link on ${host}:\n\n${url}\n\nOpen it in a new tab?`)) window.open(url, "_blank", "noopener,noreferrer");
}

function expiresSoon(...urls: string[]): boolean {
  return urls.some(url => {
    const at = presignedExpiry(url);
    return at !== null && at < Date.now() + 30_000;
  });
}

type SessionProps = {
  raw: string;
  shell: string;
  label: string;
  visible: boolean;
  inline: boolean;
  onResize: (height: number) => void;
  onStall: (heard: boolean) => void;
};

/** One run of the iframe. Remounting it is the only way to restart an embed. */
function EmbedSession({ raw, shell, label, visible, inline, onResize, onStall }: SessionProps) {
  const [src] = useState(() => `${shell}#src=${encodeURIComponent(raw)}`);
  const [ready, setReady] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const channel = useRef<{ port: MessagePort; lastBeat: number; heard: boolean } | null>(null);
  const startedAt = useRef(0);

  useEffect(() => {
    startedAt.current = performance.now();
    const element = frame.current;
    return () => {
      channel.current?.port.close();
      channel.current = null;
      if (element) element.src = "about:blank";
    };
  }, []);

  useEffect(() => {
    channel.current?.port.postMessage({ type: "visibility", visible });
    if (!visible) return;
    startedAt.current = performance.now();
    if (channel.current) channel.current.lastBeat = performance.now();
    // An embed that stops answering (an infinite loop, a crashed renderer, an expired URL) is swapped for its poster.
    const timer = setInterval(() => {
      const heard = Boolean(channel.current?.heard);
      const since = heard ? channel.current!.lastBeat : startedAt.current;
      if (performance.now() - since > EMBED_STALL_MS) onStall(heard);
    }, EMBED_HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [visible, onStall]);

  useEffect(() => {
    const media = window.matchMedia(DARK);
    const update = () => channel.current?.port.postMessage({ type: "theme", ...embedTheme() });
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const connect = () => {
    const target = frame.current?.contentWindow;
    if (channel.current || !target) return;
    const { port1, port2 } = new MessageChannel();
    const allow = messageBudget();
    const state = { port: port1, lastBeat: performance.now(), heard: false };
    channel.current = state;
    port1.onmessage = event => {
      if (channel.current !== state || !allow(performance.now())) return;
      const message = parseEmbedMessage(event.data);
      if (!message) return;
      state.heard = true;
      state.lastBeat = performance.now();
      switch (message.type) {
        case "ready":
          setReady(true);
          break;
        case "resize":
          if (inline) onResize(clampHeight(message.height, maxHeight()));
          break;
        case "openLink":
          openLink(message.url);
          break;
        case "error":
          console.warn("[marker] embed error:", message.message);
          break;
      }
    };
    const width = frame.current?.clientWidth ?? 0;
    target.postMessage({ type: "init", v: 1, ...embedTheme(), width, reducedMotion: reducedMotion(), lang: document.documentElement.lang || navigator.language }, "*", [port2]);
  };

  return <iframe
    ref={frame}
    src={src}
    title={label || "Interactive embed"}
    sandbox="allow-scripts"
    referrerPolicy="no-referrer"
    allow=""
    loading="lazy"
    data-ready={ready ? "" : undefined}
    onLoad={connect}
    {...{ credentialless: "" }}
  />;
}

const subscribeTab = (onChange: () => void) => {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
};
const tabVisibleNow = () => document.visibilityState !== "hidden";
const tabVisibleOnServer = () => true;

type FrameProps = {
  raw: string;
  shell: string;
  poster: string | null;
  params: EmbedParams;
  label: string;
  mode: "inline" | "dialog";
  paused?: boolean;
  onStale: () => void;
  onExpand?: () => void;
  onClose?: () => void;
};

/**
 * The plate: poster or paper until the embed is ready, controls on top.
 * Starts when it first scrolls into view, stops at once for a hidden tab and
 * after 30s off-screen, and restarts on return.
 */
function EmbedFrame({ raw, shell, poster, params, label, mode, paused = false, onStale, onExpand, onClose }: FrameProps) {
  const plate = useRef<HTMLSpanElement>(null);
  const urls = `${shell}\n${raw}`;
  const [onScreen, setOnScreen] = useState(mode === "dialog");
  const [parked, setParked] = useState(mode === "inline");
  const [run, setRun] = useState(0);
  const [height, setHeight] = useState<number | null>(params.h);
  /** "*" after a hang; otherwise the URLs that failed to start, so fresh URLs retry on their own. */
  const [stall, setStall] = useState<string | null>(null);
  const [waitingFor, setWaitingFor] = useState<string | null>(null);
  const tabVisible = useSyncExternalStore(subscribeTab, tabVisibleNow, tabVisibleOnServer);
  const stalled = stall === "*" || stall === urls;
  const active = !parked && tabVisible && !paused && !stalled && waitingFor !== urls;

  const latest = useRef({ raw, shell, urls, onStale });
  useEffect(() => {
    latest.current = { raw, shell, urls, onStale };
  });

  const ensureFresh = useCallback(() => {
    const { raw, shell, urls, onStale } = latest.current;
    if (!expiresSoon(raw, shell)) return true;
    setWaitingFor(urls);
    onStale();
    return false;
  }, []);

  useEffect(() => {
    if (mode !== "inline" || !plate.current) return;
    const observer = new IntersectionObserver(([entry]) => {
      setOnScreen(entry.isIntersecting);
      if (entry.isIntersecting) {
        ensureFresh();
        setParked(false);
      }
    }, { rootMargin: "100px 0px" });
    observer.observe(plate.current);
    return () => observer.disconnect();
  }, [mode, ensureFresh]);

  useEffect(() => {
    if (!active || onScreen) return;
    const timer = setTimeout(() => setParked(true), EMBED_OFFSCREEN_STOP_MS);
    return () => clearTimeout(timer);
  }, [active, onScreen]);

  const onStall = useCallback((heard: boolean) => {
    console.warn(heard ? "[marker] embed stopped responding; showing its poster" : "[marker] embed did not start; showing its poster");
    setStall(heard ? "*" : latest.current.urls);
    if (!heard) latest.current.onStale();
  }, []);

  const reload = () => {
    setStall(null);
    setRun(n => n + 1);
    ensureFresh();
  };

  const size = mode === "dialog" ? undefined
    : height !== null ? { height }
    : params.ratio ? { aspectRatio: `${params.ratio[0]} / ${params.ratio[1]}` }
    : { height: EMBED_DEFAULT_HEIGHT };

  return <span ref={plate} className="note-embed-plate" data-phase={active ? "loading" : stalled ? "stalled" : "idle"} data-mode={mode} style={size}>
    {poster
      // eslint-disable-next-line @next/next/no-img-element -- presigned URL, not optimizable
      ? <img className="note-embed-poster" src={poster} alt="" aria-hidden="true" referrerPolicy="no-referrer" />
      : <span className="note-embed-paper" aria-hidden="true" />}
    {active && <EmbedSession key={run} raw={raw} shell={shell} label={label} visible={onScreen} inline={mode === "inline"} onResize={setHeight} onStall={onStall} />}
    {stalled && <span className="sr-only" role="status">Embed stopped. Reload to try again.</span>}
    <span className="note-embed-controls">
      <button type="button" className="note-embed-pill" aria-label="Reload embed" title="Reload" onClick={reload}>↻</button>
      {mode === "inline"
        ? <button type="button" className="note-embed-pill" aria-label="Expand embed" title="Expand" onClick={onExpand}>⤢</button>
        : <button type="button" className="note-embed-pill" aria-label="Close embed" title="Close" onClick={onClose}>×</button>}
    </span>
  </span>;
}

function EmbedDialog({ label, onClose, ...frame }: Omit<FrameProps, "mode" | "onExpand" | "onClose"> & { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  return createPortal(<dialog ref={ref} className="note-embed-dialog" aria-label={label || "Embed"} onClose={onClose}>
    <EmbedFrame {...frame} label={label} mode="dialog" onClose={() => ref.current?.close()} />
  </dialog>, document.body);
}

/** `![caption](marker-embed:<id> "h=420 poster=marker-asset:<id>")`: an agent's sandboxed HTML figure. */
export function NoteEmbed({ src, alt = "", title }: { src: string; alt?: string; title?: string }) {
  const assets = useAssetUrls();
  const [expanded, setExpanded] = useState(false);
  const id = src.slice(EMBED_SCHEME.length);
  const valid = EMBED_ID_PATTERN.test(id);
  const params = useMemo(() => parseEmbedParams(title), [title]);
  const raw = valid ? assets?.urls[id] ?? null : null;
  const shell = assets?.embedShellUrl ?? null;
  const poster = params.poster ? assets?.urls[params.poster] ?? null : null;
  const refresh = assets?.refresh;
  const canRefresh = valid && Boolean(assets?.enabled) && !assets?.recentlyChecked(id);
  const onStale = useCallback(() => refresh?.(id), [refresh, id]);

  useEffect(() => {
    if ((!raw || !shell) && canRefresh) refresh?.(id);
  }, [raw, shell, canRefresh, refresh, id]);

  if (!raw || !shell) {
    return <span className="note-embed" data-state={canRefresh ? "loading" : "missing"}>
      {canRefresh && <span className="note-embed-plate" data-phase="loading" style={{ height: params.h ?? EMBED_DEFAULT_HEIGHT }}><span className="note-embed-paper" aria-hidden="true" /></span>}
      <span className="note-embed-caption">{alt || (canRefresh ? "Loading embed…" : "Embed unavailable")}</span>
    </span>;
  }

  return <span className="note-embed" data-state="ready" role="group" aria-label={alt || "Interactive embed"}>
    <EmbedFrame raw={raw} shell={shell} poster={poster} params={params} label={alt} mode="inline" paused={expanded} onStale={onStale} onExpand={() => setExpanded(true)} />
    {alt && <span className="note-embed-caption">{alt}</span>}
    {expanded && <EmbedDialog raw={raw} shell={shell} poster={poster} params={params} label={alt} onStale={onStale} onClose={() => setExpanded(false)} />}
  </span>;
}
