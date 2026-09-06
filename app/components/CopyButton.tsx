"use client";

import { useEffect, useRef, useState } from "react";
import { copyToClipboard } from "../lib/clipboard";

interface CopyButtonProps {
  text: string;
  label?: string;
  copiedLabel?: string;
  className?: string;
  disabled?: boolean;
}

const defaultClassName =
  "px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50 transition-colors";

export function CopyButton({
  text,
  label = "Copy all",
  copiedLabel = "Copied",
  className = defaultClassName,
  disabled = false,
}: CopyButtonProps) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  function flash(next: "copied" | "failed") {
    setStatus(next);
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = window.setTimeout(() => {
      setStatus("idle");
      timeoutRef.current = null;
    }, 1500);
  }

  async function handleCopy() {
    if (disabled) return;
    try {
      await copyToClipboard(text);
      flash("copied");
    } catch {
      flash("failed");
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      disabled={disabled}
      aria-live="polite"
      data-copy-status={status}
      className={className}
    >
      {status === "copied" ? copiedLabel : status === "failed" ? "Copy failed" : label}
    </button>
  );
}
