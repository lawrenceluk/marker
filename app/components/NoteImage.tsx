"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { EMBED_SCHEME } from "../lib/embedPolicy";
import { useNoteSession } from "./NoteSession";

export const ASSET_SCHEME = "marker-asset:";
const ASSET_ID = /^[A-Za-z0-9_-]{22}$/;
const REFRESH_COOLDOWN_MS = 10_000;
const RECHECK_AFTER_MS = 30 * 60_000;

type AssetUrlsValue = {
  enabled: boolean;
  urls: Record<string, string>;
  embedShellUrl: string | null;
  /** True when a refresh looked this id up recently, so a still-missing or failing image renders as unavailable. */
  recentlyChecked: (id: string) => boolean;
  refresh: (id: string) => void;
  register: (id: string, url: string) => void;
};

const AssetUrlsContext = createContext<AssetUrlsValue | null>(null);

export function AssetUrlsProvider({ enabled, urls: seeded, embedShellUrl: seededShell = null, children }: { enabled: boolean; urls: Record<string, string>; embedShellUrl?: string | null; children: React.ReactNode }) {
  const { noteFetch } = useNoteSession();
  const [urls, setUrls] = useState(seeded);
  const [embedShellUrl, setEmbedShellUrl] = useState(seededShell);
  const [checked, setChecked] = useState<ReadonlyMap<string, number>>(() => new Map());
  const pending = useRef<Set<string>>(new Set());
  const lastRefresh = useRef(0);
  const inFlight = useRef(false);

  useEffect(() => {
    setUrls(current => ({ ...current, ...seeded }));
  }, [seeded]);

  const refresh = useCallback((id: string) => {
    if (!enabled) return;
    pending.current.add(id);
    if (inFlight.current) return;
    const wait = Math.max(0, lastRefresh.current + REFRESH_COOLDOWN_MS - Date.now());
    inFlight.current = true;
    setTimeout(async () => {
      lastRefresh.current = Date.now();
      try {
        const res = await noteFetch("/api/assets/urls", { cache: "no-store" });
        const data = res.ok ? await res.json() as { urls?: Record<string, string>; embed_shell?: string | null } : null;
        if (data?.urls) setUrls(current => ({ ...current, ...data.urls }));
        if (data?.embed_shell) setEmbedShellUrl(data.embed_shell);
      } catch {
        // Placeholders stay; the next failed load retries after the recheck window.
      } finally {
        // The response covers every image on the note, including ids requested while it was in flight.
        const ids = [...pending.current];
        pending.current.clear();
        inFlight.current = false;
        const at = Date.now();
        setChecked(current => new Map([...current, ...ids.map(id => [id, at] as const)]));
      }
    }, wait);
  }, [enabled, noteFetch]);

  const recentlyChecked = useCallback((id: string) => {
    const at = checked.get(id);
    return at !== undefined && Date.now() - at < RECHECK_AFTER_MS;
  }, [checked]);
  const register = useCallback((id: string, url: string) => setUrls(current => ({ ...current, [id]: url })), []);
  const value = useMemo(() => ({ enabled, urls, embedShellUrl, recentlyChecked, refresh, register }), [enabled, urls, embedShellUrl, recentlyChecked, refresh, register]);
  return <AssetUrlsContext.Provider value={value}>{children}</AssetUrlsContext.Provider>;
}

/** `{id: url}` from the `assets` list on GET /api/content. */
export function urlsFromAssets(assets: unknown): Record<string, string> {
  if (!Array.isArray(assets)) return {};
  const out: Record<string, string> = {};
  for (const asset of assets) if (typeof asset?.id === "string" && typeof asset?.url === "string") out[asset.id] = asset.url;
  return out;
}

export function useAssetUrls() {
  return useContext(AssetUrlsContext);
}

/** Lets `marker-asset:` and `marker-embed:` through react-markdown's URL sanitizer; everything else keeps the default. */
export function markerUrlTransform(url: string, fallback: (url: string) => string): string {
  return url.startsWith(ASSET_SCHEME) || url.startsWith(EMBED_SCHEME) ? url : fallback(url);
}

/** External images load over https only; anything else is not fetched. */
function externalSrc(src: string): string | null {
  try {
    const url = new URL(src);
    if (url.protocol === "https:") return url.href;
    if (url.protocol === "http:") {
      url.protocol = "https:";
      return url.href;
    }
  } catch {}
  return null;
}

function Placeholder({ alt, state }: { alt: string; state: "loading" | "unavailable" }) {
  return <span className="note-image-placeholder" role="img" aria-label={alt || (state === "loading" ? "Loading image" : "Image unavailable")} data-state={state}>
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.5" /><circle cx="9" cy="10" r="1.75" stroke="currentColor" strokeWidth="1.5" /><path d="m4 18 5-5 4 4 2.5-2.5L20 18" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
    <span>{state === "loading" ? "Loading image…" : "Image unavailable"}{alt ? ` · ${alt}` : ""}</span>
  </span>;
}

function Lightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  return createPortal(<dialog ref={ref} className="note-lightbox" aria-label={alt || "Image"} onClose={onClose} onClick={onClose}>
    {/* eslint-disable-next-line @next/next/no-img-element -- presigned or external URLs, not optimizable */}
    <img src={src} alt={alt} referrerPolicy="no-referrer" />
    <button type="button" className="note-lightbox-close" aria-label="Close image">×</button>
  </dialog>, document.body);
}

export function NoteImage({ src, alt = "", title }: { src?: string; alt?: string; title?: string }) {
  const assets = useAssetUrls();
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const assetId = src?.startsWith(ASSET_SCHEME) ? src.slice(ASSET_SCHEME.length) : null;
  const validAsset = assetId !== null && ASSET_ID.test(assetId);
  const resolved = !src ? null : assetId !== null ? (validAsset ? assets?.urls[assetId] ?? null : null) : externalSrc(src);
  const refresh = assets?.refresh;
  const broken = !resolved || failed === resolved;
  // An expired presigned URL fails like a missing object, so a failure asks for fresh URLs once per check window.
  const canRefresh = validAsset && Boolean(assets?.enabled) && !assets?.recentlyChecked(assetId!);

  useEffect(() => {
    if (broken && canRefresh) refresh?.(assetId!);
  }, [assetId, broken, canRefresh, refresh]);

  if (broken) return <Placeholder alt={alt} state={canRefresh ? "loading" : "unavailable"} />;

  return <>
    <button type="button" className="note-image" aria-label={alt ? `Open image: ${alt}` : "Open image"} onClick={() => setOpen(true)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- presigned or external URLs, not optimizable */}
      <img src={resolved} alt={alt} title={title} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(resolved)} />
    </button>
    {open && <Lightbox src={resolved} alt={alt} onClose={() => setOpen(false)} />}
  </>;
}
