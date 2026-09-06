"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

export const toolbarButtonClass =
  "inline-flex items-center justify-center p-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50 transition-colors";

export const toolbarButtonActiveClass =
  "inline-flex items-center justify-center p-2 rounded-lg border border-zinc-900 dark:border-zinc-100 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:opacity-50 transition-colors";

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
      title={label}
      aria-pressed={pressed}
      className={
        className ?? (pressed ? toolbarButtonActiveClass : toolbarButtonClass)
      }
      {...props}
    >
      {children}
    </button>
  );
}
