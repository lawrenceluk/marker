"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, X, type LucideIcon } from "lucide-react";
import { copyToClipboard } from "../lib/clipboard";
import { ToolbarTooltip, toolbarButtonClass } from "./ToolbarButton";

interface CopyButtonProps {
  text: string;
  label?: string;
  copiedLabel?: string;
  className?: string;
  disabled?: boolean;
  /** Icon-only control; `label` is used for aria-label and the hover tooltip. */
  icon?: boolean;
  idleIcon?: LucideIcon;
  tooltipAlign?: "start" | "center" | "end";
}

const defaultClassName =
  "px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50 transition-colors";

export function CopyButton({
  text,
  label = "Copy all",
  copiedLabel = "Copied",
  className,
  disabled = false,
  icon = false,
  idleIcon: IdleIcon = Copy,
  tooltipAlign,
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

  const statusLabel =
    status === "copied" ? copiedLabel : status === "failed" ? "Copy failed" : label;

  return (
    <button
      type="button"
      onClick={handleCopy}
      disabled={disabled}
      aria-live="polite"
      aria-label={icon ? statusLabel : undefined}
      data-copy-status={status}
      className={className ?? (icon ? toolbarButtonClass : defaultClassName)}
    >
      {icon ? (
        status === "copied" ? (
          <Check size={18} />
        ) : status === "failed" ? (
          <X size={18} />
        ) : (
          <IdleIcon size={18} />
        )
      ) : status === "copied" ? (
        copiedLabel
      ) : status === "failed" ? (
        "Copy failed"
      ) : (
        label
      )}
      {icon ? <ToolbarTooltip label={statusLabel} align={tooltipAlign} /> : null}
    </button>
  );
}
