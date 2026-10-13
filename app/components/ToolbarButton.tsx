"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { iconButtonClass, iconButtonPressedClass } from "./controlStyles";

/** Figma IconButton. */
export const toolbarButtonClass = iconButtonClass;

export const toolbarButtonActiveClass = iconButtonPressedClass;

const toolbarTooltipBaseClass =
  "pointer-events-none absolute z-20 whitespace-nowrap rounded-md bg-slab px-2 py-1 text-xs font-medium text-on-slab opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100";

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
