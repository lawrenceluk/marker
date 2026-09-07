import { headers } from "next/headers";

const FALLBACK_HOST = "marker.luk.xyz";

/** Public origin for absolute OG URLs, from forwarded request headers. */
export async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? FALLBACK_HOST)
    .split(",")[0]
    .trim();
  const protoHeader = h.get("x-forwarded-proto");
  const proto = (
    protoHeader ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https")
  )
    .split(",")[0]
    .trim();
  return `${proto}://${host}`;
}
