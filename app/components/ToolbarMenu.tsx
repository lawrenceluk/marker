"use client";

import { useId, useRef, type ReactNode } from "react";
import { ToolbarButton } from "./ToolbarButton";

export function closeMenu(button: HTMLElement) {
  button.closest<HTMLElement>("[popover]")?.hidePopover();
}

interface ToolbarMenuProps {
  label: string;
  icon: ReactNode;
  children: ReactNode;
  /** Accessible name for the trigger when several menus share a tooltip label. */
  triggerLabel?: string;
  tooltipAlign?: "start" | "center" | "end";
  className?: string;
}

/** Native popover supplies outside-tap/Escape dismissal and focus restoration. */
export function ToolbarMenu({ label, icon, children, triggerLabel, tooltipAlign, className }: ToolbarMenuProps) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  return <div className={className}>
    <ToolbarButton label={label} aria-label={triggerLabel ?? label} tooltipAlign={tooltipAlign} popoverTarget={id} aria-haspopup="dialog" onClick={event => {
      trigger.current = event.currentTarget;
      const rect = event.currentTarget.getBoundingClientRect();
      panel.current!.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 208))}px`;
      panel.current!.style.top = `${rect.bottom + 8}px`;
    }}>{icon}</ToolbarButton>
    <div id={id} ref={panel} popover="auto" role="dialog" aria-label={`${triggerLabel ?? label} options`} className="toolbar-menu"
      onToggle={event => {
        if (event.currentTarget.matches(":popover-open"))
          event.currentTarget.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
        else if (document.activeElement === document.body || event.currentTarget.contains(document.activeElement))
          trigger.current?.focus();
      }}
      onKeyDown={event => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.currentTarget.hidePopover();
          trigger.current?.focus();
          return;
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }}>{children}</div>
  </div>;
}
