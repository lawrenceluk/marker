"use client";

import { useEffect, useRef, useState } from "react";
import {
  primaryButtonClass,
  secondaryButtonClass,
  textInputClass,
} from "./controlStyles";

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
        aria-label="New secret key"
        disabled={isSaving}
        className={`flex-1 px-3 py-2 font-mono text-sm ${textInputClass}`}
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSaving}
          className={`px-3 py-2 text-sm ${secondaryButtonClass}`}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!key.trim() || isSaving}
          className={`px-3 py-2 text-sm ${primaryButtonClass}`}
        >
          {isSaving ? "Changing key…" : "Change key"}
        </button>
      </div>
    </form>
  );
}
