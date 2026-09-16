import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Same mark as favicon / OG — PNG embedded in `app/icon.svg`. */
async function markDataUrl(): Promise<string> {
  const svg = await readFile(join(process.cwd(), "app/icon.svg"), "utf8");
  const match = svg.match(/base64,([A-Za-z0-9+/=]+)/);
  if (!match?.[1]) {
    throw new Error("Marker mark missing from app/icon.svg");
  }
  return `data:image/png;base64,${match[1]}`;
}

export default async function AppleIcon() {
  const mark = await markDataUrl();

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#000",
        }}
      >
        <img src={mark} width={180} height={180} alt="Marker" />
      </div>
    ),
    { ...size }
  );
}
