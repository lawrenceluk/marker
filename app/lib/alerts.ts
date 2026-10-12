import { STORAGE_STOP_BYTES, STORAGE_WARN_BYTES } from "./assetIndex";

export type StorageAlert = "warn" | "stop";

const gb = (bytes: number) => (bytes / 1e9).toFixed(2);

/**
 * Email the operator through Resend. Without RESEND_API_KEY / ALERT_EMAIL_TO
 * it only logs. Returns false when a configured send failed, so the caller
 * can release the dedupe flag and retry on the next sweep.
 */
export async function sendStorageAlert(kind: StorageAlert, totalBytes: number, env: Record<string, string | undefined> = process.env): Promise<boolean> {
  const subject = kind === "warn"
    ? `Marker images: R2 storage passed ${gb(STORAGE_WARN_BYTES)} GB`
    : `Marker images: uploads stopped at ${gb(STORAGE_STOP_BYTES)} GB`;
  const text = [
    `Reserved image storage is ${gb(totalBytes)} GB (${env.VERCEL_ENV ?? "unknown"} environment).`,
    kind === "warn"
      ? `New uploads stop at ${gb(STORAGE_STOP_BYTES)} GB; the R2 free tier is 10 GB-month.`
      : "New image uploads are refused with 507 until usage drops. Existing images keep working.",
    "You get one email per threshold crossing.",
  ].join("\n\n");
  const { RESEND_API_KEY, ALERT_EMAIL_TO } = env;
  if (!RESEND_API_KEY || !ALERT_EMAIL_TO) {
    console.error(`[marker] storage alert (${kind}, email not configured): ${subject}`);
    return true;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from: env.ALERT_EMAIL_FROM || "Marker <onboarding@resend.dev>", to: ALERT_EMAIL_TO.split(",").map(s => s.trim()).filter(Boolean), subject, text }),
    });
    if (!res.ok) throw new Error(`Resend responded ${res.status}`);
    return true;
  } catch (error) {
    console.error(`[marker] storage alert email failed (${kind}):`, error);
    return false;
  }
}
