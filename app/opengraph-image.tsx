import { ImageResponse } from "next/og";

export const alt = "Marker";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Link-unfurl image: brand mark so previews aren't stuck on a stale favicon. */
export default function OpenGraphImage() {
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
        <div
          style={{
            width: 280,
            height: 280,
            borderRadius: 56,
            background: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 180,
            fontWeight: 700,
            color: "#18181b",
            fontFamily: "ui-sans-serif, system-ui, sans-serif",
          }}
        >
          M
        </div>
      </div>
    ),
    { ...size }
  );
}
