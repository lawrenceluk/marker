import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { r2Config, listObjects, deleteObject } from "@/app/lib/r2";
import { claimStorageAlerts, dueSweepMembers, finishPurge, visitSweepMember } from "@/app/lib/assets";
import { deleteAssetObjects, deliverStorageAlert } from "@/app/lib/assetJobs";

export const maxDuration = 60;

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Daily (Vercel Cron): delete images unreferenced past their grace period,
 * purge the prefixes of deleted or expired notes, and send storage alerts.
 */
export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const config = r2Config();
  if (!config) return NextResponse.json({ error: "Images are not configured on this deployment" }, { status: 503 });

  const now = Date.now();
  let removed = 0, purged = 0, failed = 0;
  const members = await dueSweepMembers(now);
  for (const member of members) {
    const visit = await visitSweepMember(member, now);
    if (visit.kind === "ok" && visit.removed.length) {
      if (await deleteAssetObjects(config, visit.ns, visit.removed)) removed += visit.removed.length;
      else failed++;
    } else if (visit.kind === "purge") {
      try {
        const keys = await listObjects(config, `${visit.ns}/`);
        const results = await Promise.allSettled(keys.map(k => deleteObject(config, k)));
        if (results.some(r => r.status === "rejected")) throw new Error("some deletes failed");
        await finishPurge(member, visit.ns);
        purged++;
      } catch (error) {
        console.error("[marker] asset purge failed:", error);
        failed++;
      }
    }
  }

  const alerts = await claimStorageAlerts(now);
  if (alerts.warn) await deliverStorageAlert("warn", alerts.totalBytes);
  return NextResponse.json({ visited: members.length, removed, purged, failed, total_bytes: alerts.totalBytes });
}
