import { after } from "next/server";
import { sendStorageAlert, type StorageAlert } from "./alerts";
import { objectKey, releaseStorageAlert } from "./assets";
import { deleteObject, type R2Config } from "./r2";

/** `after()` on Vercel; outside a request scope (scripts, tests) just start the task. */
export function runAfter(task: () => Promise<unknown>): void {
  const guarded = () => task().catch(error => console.error("[marker] background task failed:", error));
  try {
    after(guarded);
  } catch {
    void guarded();
  }
}

/** Best-effort; anything left behind is purged by the daily sweep. */
export async function deleteAssetObjects(config: R2Config, ns: string, ids: string[]): Promise<boolean> {
  const results = await Promise.allSettled(ids.map(id => deleteObject(config, objectKey(ns, id))));
  return results.every(r => r.status === "fulfilled");
}

export async function deliverStorageAlert(kind: StorageAlert, totalBytes: number): Promise<void> {
  if (!(await sendStorageAlert(kind, totalBytes))) await releaseStorageAlert(kind);
}
