"use client";

import { useState } from "react";
import {
  primaryButtonClass,
  secondaryButtonClass,
  textInputClass,
} from "./controlStyles";

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
          aria-label="Secret key"
          className={`w-full px-4 py-3 ${textInputClass}`}
          disabled={busy}
          autoFocus
        />
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="submit"
            disabled={!key.trim() || busy}
            className={`flex-1 px-4 py-3 ${primaryButtonClass}`}
          >
            {isLoading ? "Opening…" : "Open note"}
          </button>
          <button
            type="button"
            onClick={onRandomize}
            disabled={busy}
            className={`flex-1 px-4 py-3 ${secondaryButtonClass}`}
          >
            {isRandomizing ? "Creating…" : "New random note"}
          </button>
        </div>
      </div>
    </form>
  );
}
