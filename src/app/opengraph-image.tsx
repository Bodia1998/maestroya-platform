import { ImageResponse } from "next/og";

import { SITE_DESCRIPTION, SITE_NAME } from "@/shared/seo/site";

/**
 * Module 43 — SEO Infrastructure: default Open Graph / Twitter card image
 * for every page that doesn't define its own (professional/company
 * profiles override this with their own real photo — see
 * `(marketing)/professionals/[id]/page.tsx`'s and
 * `(marketing)/companies/[id]/page.tsx`'s `generateMetadata`). Generated
 * at request time via `ImageResponse` for the same "no design asset in
 * this repo yet" reason `icon.tsx` documents. Next's file convention
 * serves this at `/opengraph-image` and wires both `og:image` and (absent
 * a sibling `twitter-image.tsx`) the Twitter card image to it
 * automatically — no manual `metadata.openGraph.images`/`metadata.twitter.images`
 * wiring needed for the pages that don't override it.
 */
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "center",
          background: "#1954B4",
          color: "#ffffff",
          padding: "80px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ fontSize: 72, fontWeight: 700 }}>{SITE_NAME}</div>
        <div style={{ fontSize: 32, marginTop: 24, maxWidth: 900, opacity: 0.9 }}>
          {SITE_DESCRIPTION}
        </div>
      </div>
    ),
    { ...size },
  );
}
