/** Preview must never address production keys, including legacy reads and OG. */
export function storagePrefix(
  env: Record<string, string | undefined> = process.env,
): string {
  return env.VERCEL_ENV === "preview" ? "marker-commenting-preview-v1:" : "";
}
