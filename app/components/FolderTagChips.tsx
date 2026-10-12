"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CreatorSort } from "../lib/creators";
import { folderHref } from "../lib/folderHref";

/** A second tap on the same chip within this window selects only that tag. */
const DOUBLE_TAP_MS = 300;
const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP_PX = 10;

const sameTags = (a: string[], b: string[]) => a.join("\n") === b.join("\n");

interface FolderTagChipsProps {
  tags: { tag: string; count: number }[];
  selected: string[];
  sort: CreatorSort;
}

/**
 * Tap toggles a tag into the AND filter; double-tap, double-click or
 * long-press selects only that tag. Taps are applied immediately and the
 * navigation is debounced, so a burst of taps costs one folder listing.
 */
export function FolderTagChips({ tags, selected, sort }: FolderTagChipsProps) {
  const router = useRouter();
  const [pending, setPending] = useState<string[] | null>(null);
  const [scheduled, setScheduled] = useState(false);
  const [shownKey, setShownKey] = useState(selected.join("\n"));
  const navTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const press = useRef<{ tag: string; x: number; y: number } | null>(null);
  const lastTap = useRef<{ tag: string; at: number } | null>(null);
  const suppressClick = useRef(false);
  const current = useRef(selected);

  const selectedKey = selected.join("\n");
  if (selectedKey !== shownKey) {
    setShownKey(selectedKey);
    if (!scheduled) setPending(null);
  }
  const active = pending ?? selected;

  useEffect(() => { current.current = selected; }, [selected]);
  useEffect(() => () => {
    if (navTimer.current) clearTimeout(navTimer.current);
    if (pressTimer.current) clearTimeout(pressTimer.current);
  }, []);

  function navigate(next: string[], delay: number) {
    if (navTimer.current) clearTimeout(navTimer.current);
    setPending(next);
    setScheduled(true);
    navTimer.current = setTimeout(() => {
      navTimer.current = null;
      setScheduled(false);
      if (!sameTags(next, current.current)) router.push(folderHref(next, sort), { scroll: false });
      else setPending(null);
    }, delay);
  }

  function selectOnly(tag: string) {
    lastTap.current = null;
    navigate([tag], 0);
  }

  function cancelPress() {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
    press.current = null;
  }

  function onPointerDown(event: PointerEvent<HTMLButtonElement>, tag: string) {
    if (event.button !== 0) return;
    suppressClick.current = false;
    cancelPress();
    press.current = { tag, x: event.clientX, y: event.clientY };
    pressTimer.current = setTimeout(() => {
      pressTimer.current = null;
      press.current = null;
      suppressClick.current = true;
      selectOnly(tag);
    }, LONG_PRESS_MS);
  }

  function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
    const start = press.current;
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > LONG_PRESS_SLOP_PX) cancelPress();
  }

  function onClick(tag: string, timeStamp: number, detail: number) {
    if (suppressClick.current) {
      suppressClick.current = false;
      // Keyboard activation (detail 0) never follows a long-press.
      if (detail !== 0) return;
    }
    const last = lastTap.current;
    if (last && last.tag === tag && timeStamp - last.at < DOUBLE_TAP_MS) {
      selectOnly(tag);
      return;
    }
    lastTap.current = { tag, at: timeStamp };
    navigate(active.includes(tag) ? active.filter(t => t !== tag) : [...active, tag].sort(), DOUBLE_TAP_MS);
  }

  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by tags" aria-describedby="tag-chip-hint">
      <span id="tag-chip-hint" className="sr-only">Double-tap or long-press a tag to show only that tag.</span>
      {tags.map(({ tag, count }) => (
        <button
          type="button"
          key={tag}
          aria-pressed={active.includes(tag)}
          className={`creator-tag creator-tag-chip ${active.includes(tag) ? "creator-tag-on" : ""}`}
          onPointerDown={event => onPointerDown(event, tag)}
          onPointerMove={onPointerMove}
          onPointerUp={cancelPress}
          onPointerCancel={cancelPress}
          onPointerLeave={cancelPress}
          onContextMenu={event => event.preventDefault()}
          onClick={event => onClick(tag, event.timeStamp, event.detail)}
        >
          {tag} <span className="opacity-60">{count}</span>
        </button>
      ))}
      {active.length > 0 && <Link prefetch={false} href={folderHref([], sort)} className="creator-tag">Clear</Link>}
    </div>
  );
}
