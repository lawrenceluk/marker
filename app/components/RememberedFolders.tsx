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
      <h2 id="folders-heading" className="text-sm font-medium text-muted">Folders</h2>
      <ul className="list">
        {folders.map(folder => (
          <li key={folder.ref} className="list-row">
            <a href={`/c/folder/${folder.ref}`} className="list-link">
              <span className="list-title">
                {folder.unseen > 0 && <span className="list-dot" aria-hidden="true" />}
                <span>{folder.name ?? "Untitled folder"}</span>
              </span>
              {folder.count !== null && (
                <span className="list-meta">
                  <span>{folder.count} {folder.count === 1 ? "note" : "notes"}</span>
                  {folder.unseen > 0 && <span className="list-new">{folder.unseen} new</span>}
                </span>
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
