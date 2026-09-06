"use client";

import { CopyButton } from "./CopyButton";

interface PersistToggleProps {
  persist: boolean;
  shareUrl: string | null;
  onToggle: () => void;
  disabled?: boolean;
}

export function PersistToggle({
  persist,
  shareUrl,
  onToggle,
  disabled = false,
}: PersistToggleProps) {
  return (
    <div className="flex flex-col items-stretch sm:items-end gap-2">
      <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400 select-none">
        <button
          type="button"
          role="switch"
          aria-checked={persist}
          aria-label="Persistent URL"
          disabled={disabled}
          onClick={onToggle}
          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
            persist
              ? "bg-zinc-900 dark:bg-zinc-100"
              : "bg-zinc-300 dark:bg-zinc-700"
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white dark:bg-zinc-900 transition-transform ${
              persist ? "translate-x-4" : ""
            }`}
          />
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={onToggle}
          className="hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors disabled:opacity-50"
        >
          Persistent URL
        </button>
      </div>
      {persist && shareUrl && (
        <div className="flex items-center gap-2 max-w-full">
          <code
            className="text-xs text-zinc-500 dark:text-zinc-400 font-mono truncate max-w-[16rem] sm:max-w-xs"
            title={shareUrl}
          >
            {shareUrl}
          </code>
          <CopyButton
            text={shareUrl}
            label="Copy"
            className="shrink-0 text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
          />
        </div>
      )}
    </div>
  );
}
