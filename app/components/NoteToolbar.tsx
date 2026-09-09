"use client";

import { Globe, KeyRound, Link, Pencil, Search } from "lucide-react";
import { CopyButton } from "./CopyButton";
import { ToolbarButton } from "./ToolbarButton";

/** lucide-react 0.560 has Globe but not GlobeOff; same paths as later Lucide. */
function GlobeOff({ size = 18 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10.114 4.462A14.5 14.5 0 0 1 12 2a10 10 0 0 1 9.313 13.643" />
      <path d="M15.557 15.556A14.5 14.5 0 0 1 12 22 10 10 0 0 1 4.929 4.929" />
      <path d="M15.892 10.234A14.5 14.5 0 0 0 12 2a10 10 0 0 0-3.643.687" />
      <path d="M17.656 12H22" />
      <path d="M19.071 19.071A10 10 0 0 1 12 22 14.5 14.5 0 0 1 8.44 8.45" />
      <path d="M2 12h10" />
      <path d="m2 2 20 20" />
    </svg>
  );
}

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
    <div className="flex items-center justify-between gap-2 mb-6 pb-4 border-b border-zinc-200 dark:border-zinc-800 overflow-visible">
      <div className="flex items-center gap-1">
        <ToolbarButton
          label={persist ? "Persistent URL on" : "Persistent URL off"}
          pressed={persist}
          disabled={persistDisabled}
          tooltipAlign="start"
          onClick={onPersistToggle}
        >
          {persist ? <Globe size={18} /> : <GlobeOff size={18} />}
        </ToolbarButton>
        {persist && shareUrl && (
          <CopyButton
            text={shareUrl}
            label="Copy link"
            icon
            idleIcon={Link}
          />
        )}
        <ToolbarButton
          label="Rename key"
          pressed={renaming}
          onClick={onRename}
        >
          <KeyRound size={18} />
        </ToolbarButton>
        <ToolbarButton label="Go to note" onClick={onChangeKey}>
          <Search size={18} />
        </ToolbarButton>
      </div>
      <div className="flex items-center gap-1">
        <CopyButton text={content} label="Copy all" icon tooltipAlign="end" />
        <ToolbarButton label="Edit" onClick={onEdit} tooltipAlign="end">
          <Pencil size={18} />
        </ToolbarButton>
      </div>
    </div>
  );
}
