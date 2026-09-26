"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, X, type LucideIcon } from "lucide-react";
import { copyToClipboard } from "../lib/clipboard";
import { ToolbarTooltip, toolbarButtonClass } from "./ToolbarButton";
import { secondaryButtonClass } from "./controlStyles";

interface CopyButtonProps {
  text: string;
  label?: string;
  copiedLabel?: string;
  className?: string;
  disabled?: boolean;
  /** Icon-only, or an icon beside the visible label for menu rows. */
  icon?: boolean | "with-label";
  idleIcon?: LucideIcon;
  tooltipAlign?: "start" | "center" | "end";
}

const defaultClassName = `px-4 py-2 ${secondaryButtonClass}`;

export function CopyButton({
  text,
  label = "Copy text",
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

  const StatusIcon = status === "copied" ? Check : status === "failed" ? X : IdleIcon;

  return (
    <button
      type="button"
      onClick={handleCopy}
      disabled={disabled}
      aria-live="polite"
      aria-label={statusLabel}
      data-copy-status={status}
      className={className ?? (icon ? toolbarButtonClass : defaultClassName)}
    >
      {icon && <StatusIcon size={18} aria-hidden="true" />}
      {icon !== true && statusLabel}
      {icon === true ? <ToolbarTooltip label={statusLabel} align={tooltipAlign} /> : null}
    </button>
  );
}
