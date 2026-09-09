"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

export const toolbarButtonClass =
  "group relative inline-flex items-center justify-center p-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50 transition-colors";

export const toolbarButtonActiveClass =
  "group relative inline-flex items-center justify-center p-2 rounded-lg border border-zinc-900 dark:border-zinc-100 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:opacity-50 transition-colors";

const toolbarTooltipBaseClass =
  "pointer-events-none absolute z-20 whitespace-nowrap rounded-md bg-zinc-900 px-2 py-1 text-xs font-medium text-white opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 dark:bg-zinc-100 dark:text-zinc-900";

export const toolbarTooltipClass = `${toolbarTooltipBaseClass} top-full mt-1.5 left-1/2 -translate-x-1/2`;

export function ToolbarTooltip({
  label,
  placement = "below",
  align = "center",
}: {
  label: string;
  placement?: "below" | "above";
  align?: "start" | "center" | "end";
}) {
  const positionClass =
    placement === "above" ? "bottom-full mb-1.5" : "top-full mt-1.5";
  const alignClass =
    align === "start"
      ? "left-0"
      : align === "end"
        ? "right-0"
        : "left-1/2 -translate-x-1/2";
  return (
    <span
      aria-hidden="true"
      className={`${toolbarTooltipBaseClass} ${positionClass} ${alignClass}`}
    >
      {label}
    </span>
  );
}

interface ToolbarButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  pressed?: boolean;
  tooltipAlign?: "start" | "center" | "end";
  children: ReactNode;
}

export function ToolbarButton({
  label,
  pressed,
  tooltipAlign,
  children,
  className,
  ...props
}: ToolbarButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      className={
        className ?? (pressed ? toolbarButtonActiveClass : toolbarButtonClass)
      }
      {...props}
    >
      {children}
      <ToolbarTooltip label={label} align={tooltipAlign} />
    </button>
  );
}
