"use client";

import Link from "next/link";
import { Ellipsis, FolderMinus, Home } from "lucide-react";
import { ToolbarTooltip, toolbarButtonClass } from "./ToolbarButton";
import { ToolbarMenu } from "./ToolbarMenu";

export function FolderNav({ canForget }: { canForget: boolean }) {
  return (
    <nav aria-label="Folder actions" className="note-toolbar">
      <Link prefetch={false} href="/" aria-label="Home" className={toolbarButtonClass}>
        <Home size={18} />
        <ToolbarTooltip label="Home" align="start" />
      </Link>
      {canForget && (
        <ToolbarMenu label="More" icon={<Ellipsis size={18} />} tooltipAlign="end">
          <form method="post" action="/api/creator/session">
            <input type="hidden" name="forget" value="1" />
            <button type="submit" className="toolbar-menu-item"><FolderMinus size={18} aria-hidden="true" />Forget this folder</button>
          </form>
        </ToolbarMenu>
      )}
    </nav>
  );
}
