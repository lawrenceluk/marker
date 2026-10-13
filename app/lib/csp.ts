type Env = Record<string, string | undefined>;

/** Where presigned image, embed and shell URLs point; embeds are framed from here. */
export function storageOrigin(env: Env = process.env): string {
  if (env.R2_ENDPOINT) {
    try {
      return new URL(env.R2_ENDPOINT).origin;
    } catch {}
  }
  return env.R2_ACCOUNT_ID ? `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : "https://*.r2.cloudflarestorage.com";
}

/**
 * Marker's own enforced policy, fixed at build time. Agent embeds never run
 * under it: they run in sandboxed frames on the storage host with their own
 * policy (app/lib/embedPolicy.ts).
 */
export function markerCsp(env: Env = process.env): string {
  const storage = storageOrigin(env);
  const dev = env.NODE_ENV === "development";
  // Vercel's toolbar only appears on Preview deployments.
  const preview = env.VERCEL_ENV === "preview";
  const live = preview ? " https://vercel.live" : "";
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}${live}`,
    `style-src 'self' 'unsafe-inline'${live}`,
    `img-src 'self' data: blob: https:`,
    `connect-src 'self' ${storage}${preview ? " https://vercel.live wss://ws-us3.pusher.com" : ""}`,
    `font-src 'self'${preview ? " https://vercel.live https://assets.vercel.com" : ""}`,
    `frame-src 'self' ${storage}${live}`,
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join("; ");
}
