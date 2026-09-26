"use client";

import { useId, useRef, type ReactNode } from "react";
import { Ellipsis, Home, KeyRound, Pencil, Search, Share2 } from "lucide-react";
import { CopyButton } from "./CopyButton";
import { DeleteButton } from "./DeleteButton";
import { ToolbarButton } from "./ToolbarButton";

function closeMenu(button: HTMLElement) {
  button.closest<HTMLElement>("[popover]")?.hidePopover();
}

/** Native popover supplies outside-tap/Escape dismissal and focus restoration. */
function ToolbarMenu({ label, icon, children }: { label: string; icon: ReactNode; children: ReactNode }) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  return <div>
    <ToolbarButton label={label} popoverTarget={id} aria-haspopup="dialog" onClick={event => {
      trigger.current = event.currentTarget;
      const rect = event.currentTarget.getBoundingClientRect();
      panel.current!.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 208))}px`;
      panel.current!.style.top = `${rect.bottom + 8}px`;
    }}>{icon}</ToolbarButton>
    <div id={id} ref={panel} popover="auto" role="dialog" aria-label={`${label} options`} className="toolbar-menu"
      onToggle={event => {
        if (event.currentTarget.matches(":popover-open"))
          event.currentTarget.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
        else if (document.activeElement === document.body || event.currentTarget.contains(document.activeElement))
          trigger.current?.focus();
      }}
      onKeyDown={event => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.currentTarget.hidePopover();
          trigger.current?.focus();
          return;
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }}>{children}</div>
  </div>;
}

interface NoteToolbarProps {
  commentsButton?: ReactNode;
  onHome: () => void;
  showNoteTools?: boolean;
  persist?: boolean;
  shareUrl?: string | null;
  onPersistToggle?: () => void;
  persistDisabled?: boolean;
  onRename?: () => void;
  onChangeKey?: () => void;
  content?: string;
  onEdit?: () => void;
  onDelete?: () => void | Promise<void>;
  deleteDisabled?: boolean;
}

export function NoteToolbar({
  commentsButton, onHome, showNoteTools = true, persist = false, shareUrl = null,
  onPersistToggle, persistDisabled = false, onRename, onChangeKey, content = "",
  onEdit, onDelete, deleteDisabled = false,
}: NoteToolbarProps) {
  return <nav aria-label="Note actions" className="note-toolbar">
    <ToolbarButton label="Home" onClick={onHome} tooltipAlign="start"><Home size={18} /></ToolbarButton>
    {showNoteTools && <>
      <ToolbarMenu label="Share" icon={<Share2 size={18} />}>
        <CopyButton text={shareUrl ?? ""} label="Copy link" disabled={!shareUrl} className="toolbar-menu-item" />
        <button type="button" role="switch" aria-label="Persistent link" aria-checked={persist} aria-disabled={persistDisabled} onClick={() => { if (!persistDisabled) onPersistToggle?.(); }} className="toolbar-menu-item justify-between">
          {persist ? "Persistent link" : "One-time session"}<span className="text-xs opacity-50">{persist ? "On" : "Off"}</span>
        </button>
      </ToolbarMenu>
      {commentsButton}
      <ToolbarButton label="Edit" onClick={onEdit}><Pencil size={18} /></ToolbarButton>
      <ToolbarMenu label="More" icon={<Ellipsis size={18} />}>
        <button type="button" className="toolbar-menu-item" aria-label="Search" onClick={event => { closeMenu(event.currentTarget); onChangeKey?.(); }}><Search size={18} aria-hidden="true" />Search</button>
        <CopyButton text={content} label="Copy text" icon="with-label" className="toolbar-menu-item" />
        <button type="button" className="toolbar-menu-item" aria-label="Change key" onClick={event => { closeMenu(event.currentTarget); onRename?.(); }}><KeyRound size={18} aria-hidden="true" />Change key</button>
        {onDelete && <DeleteButton onDelete={onDelete} disabled={deleteDisabled} menu />}
      </ToolbarMenu>
    </>}
  </nav>;
}
