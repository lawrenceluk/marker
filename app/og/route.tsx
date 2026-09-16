import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import { normalizeKey } from "@/app/lib/key";
import { readNote } from "@/app/lib/notes";
import { ogBodyText } from "@/app/lib/preview";
import { ROBOTS_TAG } from "@/app/lib/robots";

export const runtime = "nodejs";

const SIZE = { width: 1200, height: 630 };

/**
 * Dynamic OG image: first N chars of note plaintext on a dark card.
 * Persist links already expose the note; this is the visual unfurl surface.
 */
export async function GET(request: NextRequest) {
  const key = normalizeKey(request.nextUrl.searchParams.get("key"));
  if (!key) {
    return new Response("Key is required", { status: 400 });
  }

  const note = await readNote(key);
  const body = ogBodyText(
    typeof note?.content === "string" ? note.content : ""
  );
  const text = body || "Marker";

  const image = new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-start",
          background: "#09090b",
          padding: "64px 72px",
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            display: "flex",
            flex: 1,
            color: "#fafafa",
            fontSize: 44,
            lineHeight: 1.35,
            fontFamily:
              "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            overflow: "hidden",
          }}
        >
          {text}
        </div>
      </div>
    ),
    { ...SIZE }
  );

  image.headers.set("X-Robots-Tag", ROBOTS_TAG);
  image.headers.set(
    "Cache-Control",
    "public, s-maxage=300, stale-while-revalidate=86400"
  );
  return image;
}
