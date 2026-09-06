"use client";

import { useEffect, useRef, useState } from "react";

interface RenameKeyProps {
  /** Raw key when the client already has it (typed in, or persist is on). */
  currentKey: string | null;
  onRename: (newKey: string) => void;
  onCancel: () => void;
  isSaving: boolean;
}

export function RenameKey({
  currentKey,
  onRename,
  onCancel,
  isSaving,
}: RenameKeyProps) {
  const [key, setKey] = useState(currentKey ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const next = key.trim();
    if (!next || isSaving) return;
    onRename(next);
  }

  return (
    <form onSubmit={handleSubmit} className="w-full flex flex-col sm:flex-row gap-2">
      <input
        ref={inputRef}
        type="text"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        placeholder="New secret key"
        disabled={isSaving}
        className="flex-1 px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-zinc-500 dark:focus:ring-zinc-400"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSaving}
          className="px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50 transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!key.trim() || isSaving}
          className="px-3 py-2 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-medium hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isSaving ? "Renaming..." : "Rename"}
        </button>
      </div>
    </form>
  );
}
