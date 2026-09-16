"use client";

import { useState } from "react";

interface KeyInputProps {
  onSubmit: (key: string) => void;
  onRandomize: () => void;
  isLoading: boolean;
  isRandomizing?: boolean;
}

export function KeyInput({
  onSubmit,
  onRandomize,
  isLoading,
  isRandomizing = false,
}: KeyInputProps) {
  const [key, setKey] = useState("");
  const busy = isLoading || isRandomizing;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (key.trim() && !busy) {
      onSubmit(key.trim());
    }
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-md mx-auto">
      <div className="flex flex-col gap-4">
        <input
          type="text"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Enter your secret key"
          className="w-full px-4 py-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-500 dark:focus:ring-zinc-400"
          disabled={busy}
          autoFocus
        />
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="submit"
            disabled={!key.trim() || busy}
            className="flex-1 px-4 py-3 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 font-medium hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? "Loading..." : "Access"}
          </button>
          <button
            type="button"
            onClick={onRandomize}
            disabled={busy}
            className="flex-1 px-4 py-3 rounded-lg border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isRandomizing ? "Finding key..." : "Randomize"}
          </button>
        </div>
      </div>
    </form>
  );
}
