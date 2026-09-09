"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

export const toolbarButtonClass =
  "group relative inline-flex items-center justify-center p-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50 transition-colors";

export const toolbarButtonActiveClass =
  "group relative inline-flex items-center justify-center p-2 rounded-lg border border-zinc-900 dark:border-zinc-100 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:opacity-50 transition-colors";

const toolbarTooltipBaseClass =
  "pointer-events-none absolute left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-md bg-zinc-900 px-2 py-1 text-xs font-medium text-white opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 dark:bg-zinc-100 dark:text-zinc-900";

export const toolbarTooltipClass = `${toolbarTooltipBaseClass} top-full mt-1.5`;

export function ToolbarTooltip({
  label,
  placement = "below",
}: {
  label: string;
  placement?: "below" | "above";
}) {
  const positionClass =
    placement === "above" ? "bottom-full mb-1.5" : "top-full mt-1.5";
  return (
    <span aria-hidden="true" className={`${toolbarTooltipBaseClass} ${positionClass}`}>
      {label}
    </span>
  );
}

interface ToolbarButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  pressed?: boolean;
  children: ReactNode;
}

export function ToolbarButton({
  label,
  pressed,
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
      <ToolbarTooltip label={label} />
    </button>
  );
}
