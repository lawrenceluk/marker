"use client";

import type { ReactNode } from "react";
import { CopyPlus, Ellipsis, Home, KeyRound, Pencil, Search, Share2, Tags } from "lucide-react";
import { CopyButton } from "./CopyButton";
import { DeleteButton } from "./DeleteButton";
import { ToolbarButton } from "./ToolbarButton";
import { ToolbarMenu, closeMenu } from "./ToolbarMenu";
import { PreviewTag } from "./Preview";

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
  onDuplicate?: () => void;
  duplicateDisabled?: boolean;
  content?: string;
  onEdit?: () => void;
  onDelete?: () => void | Promise<void>;
  deleteDisabled?: boolean;
  /** Present only when the viewer holds this note's creator id. */
  onEditTags?: () => void;
}

export function NoteToolbar({
  commentsButton, onHome, showNoteTools = true, persist = false, shareUrl = null,
  onPersistToggle, persistDisabled = false,   onRename, onChangeKey, onDuplicate, duplicateDisabled = false, content = "",
  onEdit, onDelete, deleteDisabled = false, onEditTags,
}: NoteToolbarProps) {
  return <nav aria-label="Note actions" className="note-toolbar">
    <ToolbarButton label="Home" onClick={onHome} tooltipAlign="start"><Home size={18} /></ToolbarButton>
    {showNoteTools && <>
      <ToolbarMenu label="Share" icon={<Share2 size={18} />}>
        <CopyButton text={shareUrl ?? ""} label="Copy link" disabled={!shareUrl} className="toolbar-menu-item" />
        <button type="button" role="switch" aria-label="Persistent link" aria-checked={persist} aria-disabled={persistDisabled} onClick={() => { if (!persistDisabled) onPersistToggle?.(); }} className="toolbar-menu-item justify-between">
          Persistent link<span className="switch" data-on={persist ? "true" : "false"} aria-hidden="true" />
        </button>
      </ToolbarMenu>
      {commentsButton}
      <ToolbarButton label="Edit" onClick={onEdit}><Pencil size={18} /></ToolbarButton>
      <PreviewTag />
      <ToolbarMenu label="More" icon={<Ellipsis size={18} />}>
        <button type="button" className="toolbar-menu-item" onClick={event => { closeMenu(event.currentTarget); onChangeKey?.(); }}><Search size={18} aria-hidden="true" />Open another note</button>
        <CopyButton text={content} label="Copy text" icon="with-label" className="toolbar-menu-item" />
        {onDuplicate && <button type="button" className="toolbar-menu-item" disabled={duplicateDisabled} onClick={event => { closeMenu(event.currentTarget); onDuplicate(); }}><CopyPlus size={18} aria-hidden="true" />Duplicate note</button>}
        <button type="button" className="toolbar-menu-item" onClick={event => { closeMenu(event.currentTarget); onRename?.(); }}><KeyRound size={18} aria-hidden="true" />Change key</button>
        {onEditTags && <button type="button" className="toolbar-menu-item" onClick={event => { closeMenu(event.currentTarget); onEditTags(); }}><Tags size={18} aria-hidden="true" />Edit tags</button>}
        {onDelete && <><hr className="toolbar-menu-rule" /><DeleteButton onDelete={onDelete} disabled={deleteDisabled} menu /></>}
      </ToolbarMenu>
    </>}
    {!showNoteTools && <PreviewTag />}
  </nav>;
}
