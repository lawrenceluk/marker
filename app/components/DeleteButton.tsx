"use client";

import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { ToolbarTooltip, toolbarButtonClass } from "./ToolbarButton";

const ARM_MS = 2000;

const armedClass =
  "group relative inline-flex items-center justify-center p-2 rounded-lg border border-red-500 bg-red-50 text-red-600 hover:bg-red-100 dark:border-red-400 dark:bg-red-950/40 dark:text-red-400 dark:hover:bg-red-950/70 disabled:opacity-50 transition-colors";

interface DeleteButtonProps {
  onDelete: () => void | Promise<void>;
  disabled?: boolean;
  menu?: boolean;
  tooltipAlign?: "start" | "center" | "end";
}

/**
 * Trash control: first click arms ("Click again to delete"), second within
 * 2s confirms. Blur or timeout cancels — no modal.
 */
export function DeleteButton({
  onDelete,
  disabled = false,
  tooltipAlign = "end",
  menu = false,
}: DeleteButtonProps) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  function clearArm() {
    setArmed(false);
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  async function handleClick() {
    if (disabled || busy) return;

    if (!armed) {
      setArmed(true);
      timerRef.current = window.setTimeout(() => {
        setArmed(false);
        timerRef.current = null;
      }, ARM_MS);
      return;
    }

    clearArm();
    setBusy(true);
    try {
      await onDelete();
    } finally {
      setBusy(false);
    }
  }

  const label = armed ? "Click again to delete" : "Delete note";

  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled || busy}
      onClick={handleClick}
      onBlur={clearArm}
      className={menu ? "toolbar-menu-item text-red-600 dark:text-red-400" : armed ? armedClass : toolbarButtonClass}
    >
      <Trash2 size={18} />
      {menu ? (armed ? label : "Delete") : <ToolbarTooltip label={label} align={tooltipAlign} />}
    </button>
  );
}
