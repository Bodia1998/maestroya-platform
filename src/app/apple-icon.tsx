import { ImageResponse } from "next/og";

/** Module 43 — SEO Infrastructure: iOS home-screen icon — see
 *  `icon.tsx`'s doc comment for why this is generated rather than a
 *  static asset. Apple Touch icons conventionally have no transparency
 *  and a larger canvas (180x180) than the general-purpose favicon. */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

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
          background: "#1954B4",
          color: "#ffffff",
          fontSize: 96,
          fontWeight: 700,
          fontFamily: "sans-serif",
        }}
      >
        M
      </div>
    ),
    { ...size },
  );
}
