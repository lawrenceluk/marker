"use client";

import { useEffect, useRef, type ComponentProps } from "react";
import { ToolbarButton } from "./ToolbarButton";

/** React touch listeners are passive; only these buttons need cancellable touches. */
export function SelectionActionButton(props: ComponentProps<typeof ToolbarButton>) {
  const host = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const button = host.current!.querySelector("button")!;
    let finger: { id: number; x: number; y: number } | null = null;
    const start = (event: TouchEvent) => {
      event.preventDefault();
      const touch = event.touches.length === 1 ? event.touches[0] : null;
      finger = touch ? { id: touch.identifier, x: touch.clientX, y: touch.clientY } : null;
    };
    const end = (event: TouchEvent) => {
      event.preventDefault(); // Suppress native selection and the compatibility click.
      const touch = Array.from(event.changedTouches).find(t => t.identifier === finger?.id);
      const rect = button.getBoundingClientRect();
      const activate = finger && touch && !event.touches.length &&
        Math.hypot(touch.clientX - finger.x, touch.clientY - finger.y) < 10 &&
        touch.clientX >= rect.left && touch.clientX <= rect.right &&
        touch.clientY >= rect.top && touch.clientY <= rect.bottom;
      finger = null;
      if (activate) button.click();
    };
    const cancel = () => { finger = null; };
    button.addEventListener("touchstart", start, { passive: false });
    button.addEventListener("touchend", end, { passive: false });
    button.addEventListener("touchcancel", cancel);
    return () => {
      button.removeEventListener("touchstart", start);
      button.removeEventListener("touchend", end);
      button.removeEventListener("touchcancel", cancel);
    };
  }, []);
  return <span ref={host} style={{ display: "contents" }}><ToolbarButton {...props} /></span>;
}
