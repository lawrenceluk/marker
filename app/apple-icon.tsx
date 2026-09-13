import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Home-screen icon: black canvas, white rounded square, dark M — matches the user favicon mark. */
export default function AppleIcon() {
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
        <div
          style={{
            width: 148,
            height: 148,
            borderRadius: 32,
            background: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 96,
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
