"use client";

import { useEffect, useState } from "react";
import { Ellipsis, FolderMinus } from "lucide-react";
import type { FolderSummary } from "../lib/folders";
import { ToolbarMenu } from "./ToolbarMenu";

/**
 * Creator folders this browser has opened, newest first. Rows link to
 * opaque refs; the server redirect sets the active folder cookie.
 */
export function RememberedFolders({ initial }: { initial?: FolderSummary[] }) {
  const [folders, setFolders] = useState<FolderSummary[] | null>(initial ?? null);

  useEffect(() => {
    if (initial) return;
    let cancelled = false;
    void fetch("/api/creator/folders")
      .then(res => (res.ok ? res.json() : { folders: [] }))
      .then((data: { folders?: FolderSummary[] }) => { if (!cancelled) setFolders(data.folders ?? []); })
      .catch(() => { if (!cancelled) setFolders([]); });
    return () => { cancelled = true; };
  }, [initial]);

  if (!folders?.length) return null;
  return (
    <section aria-labelledby="folders-heading" className="flex flex-col gap-2">
      <h2 id="folders-heading" className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Folders</h2>
      <ul className="divide-y divide-hairline rounded-lg border border-hairline">
        {folders.map(folder => (
          <li key={folder.ref} className="flex items-center gap-2 pr-2">
            <a href={`/c/folder/${folder.ref}`} className="flex min-w-0 flex-1 flex-col px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900">
              <span className="truncate font-medium text-foreground">{folder.name ?? "Untitled folder"}</span>
              {folder.count !== null && (
                <span className="text-xs text-zinc-500">{folder.count} {folder.count === 1 ? "note" : "notes"}</span>
              )}
            </a>
            <ToolbarMenu
              label="More"
              triggerLabel={`More options for ${folder.name ?? "Untitled folder"}`}
              icon={<Ellipsis size={18} />}
              tooltipAlign="end"
            >
              <form method="post" action="/api/creator/folders">
                <input type="hidden" name="forget" value={folder.ref} />
                <button type="submit" className="toolbar-menu-item"><FolderMinus size={18} aria-hidden="true" />Forget folder</button>
              </form>
            </ToolbarMenu>
          </li>
        ))}
      </ul>
    </section>
  );
}
