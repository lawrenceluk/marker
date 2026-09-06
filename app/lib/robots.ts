/** Shared anti-indexing header. Meta noindex lives in the root layout too. */
export const ROBOTS_TAG = "noindex, nofollow, noarchive, nosnippet";

export function applyNoIndexHeaders(headers: Headers) {
  headers.set("X-Robots-Tag", ROBOTS_TAG);
  headers.set("Cache-Control", "no-store, private");
}
