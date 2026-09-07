"use client";

import { ArrowLeftRight, KeyRound, Link, Pencil, Share2 } from "lucide-react";
import { CopyButton } from "./CopyButton";
import { ToolbarButton } from "./ToolbarButton";

interface NoteToolbarProps {
  persist: boolean;
  shareUrl: string | null;
  onPersistToggle: () => void;
  persistDisabled?: boolean;
  onRename: () => void;
  renaming: boolean;
  onChangeKey: () => void;
  content: string;
  onEdit: () => void;
}

export function NoteToolbar({
  persist,
  shareUrl,
  onPersistToggle,
  persistDisabled = false,
  onRename,
  renaming,
  onChangeKey,
  content,
  onEdit,
}: NoteToolbarProps) {
  return (
    <div className="flex items-center justify-between gap-2 mb-6 pb-4 border-b border-zinc-200 dark:border-zinc-800">
      <div className="flex items-center gap-1">
        <ToolbarButton
          label={persist ? "Persistent URL on" : "Persistent URL off"}
          pressed={persist}
          disabled={persistDisabled}
          onClick={onPersistToggle}
        >
          <Link size={18} />
        </ToolbarButton>
        {persist && shareUrl && (
          <CopyButton
            text={shareUrl}
            label="Copy link"
            icon
            idleIcon={Share2}
          />
        )}
        <ToolbarButton
          label="Rename key"
          pressed={renaming}
          onClick={onRename}
        >
          <KeyRound size={18} />
        </ToolbarButton>
        <ToolbarButton label="Change key" onClick={onChangeKey}>
          <ArrowLeftRight size={18} />
        </ToolbarButton>
      </div>
      <div className="flex items-center gap-1">
        <CopyButton text={content} label="Copy all" icon />
        <ToolbarButton label="Edit" onClick={onEdit}>
          <Pencil size={18} />
        </ToolbarButton>
      </div>
    </div>
  );
}
