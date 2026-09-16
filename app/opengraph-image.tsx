import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const alt = "Marker";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Load the same PNG embedded in `app/icon.svg` (M + marker tip). */
async function markDataUrl(): Promise<string> {
  const svg = await readFile(join(process.cwd(), "app/icon.svg"), "utf8");
  const match = svg.match(/base64,([A-Za-z0-9+/=]+)/);
  if (!match?.[1]) {
    throw new Error("Marker mark missing from app/icon.svg");
  }
  return `data:image/png;base64,${match[1]}`;
}

export default async function OpenGraphImage() {
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
          background: "#09090b",
        }}
      >
        <img src={mark} width={420} height={420} alt="Marker" />
      </div>
    ),
    { ...size }
  );
}
