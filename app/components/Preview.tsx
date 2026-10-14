"use client";

import { createContext, useContext, type ReactNode } from "react";
import { ToolbarTooltip } from "./ToolbarButton";

/**
 * Whether this is a Vercel preview deployment. Preview keeps its own notes (app/lib/namespace.ts),
 * so a production link opened here comes up empty; the tag says which one you are looking at.
 * The root layout reads VERCEL_ENV on the server and provides it.
 */
const PreviewContext = createContext(false);

export function PreviewProvider({ preview, children }: { preview: boolean; children: ReactNode }) {
  return <PreviewContext.Provider value={preview}>{children}</PreviewContext.Provider>;
}

export const PREVIEW_NOTE = "Notes here are separate from production";

/** Figma Tag Kind=Preview: the one place red means something other than an error. */
export function PreviewTag({ className = "" }: { className?: string }) {
  if (!useContext(PreviewContext)) return null;
  return (
    <span tabIndex={0} className={`preview-tag group relative ${className}`}>
      preview<span className="sr-only">: {PREVIEW_NOTE.toLowerCase()}</span>
      <ToolbarTooltip label={PREVIEW_NOTE} align="end" />
    </span>
  );
}
