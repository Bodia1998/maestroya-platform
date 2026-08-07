import { ImageResponse } from "next/og";

/**
 * Module 43 — SEO Infrastructure: favicon, generated at request time via
 * Next's built-in `ImageResponse` (App Router file convention — Next
 * automatically serves this at `/icon` and injects the matching
 * `<link rel="icon">` into every page's `<head>`). No static asset exists
 * in `public/` yet (this repo ships no design assets at all — see
 * `docs/MODULE_43_SEO_INFRASTRUCTURE.md`, "Known gaps"), so a generated
 * placeholder using the brand primary color (`--primary` in
 * `globals.css`) is the lowest-risk way to have *a* favicon rather than
 * none, without inventing a design asset pipeline this module isn't
 * scoped to build. Trivially replaceable later with a static
 * `app/icon.png` once real brand assets exist — Next resolves that the
 * same way, no metadata change required.
 */
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
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
          fontSize: 20,
          fontWeight: 700,
          fontFamily: "sans-serif",
          borderRadius: 6,
        }}
      >
        M
      </div>
    ),
    { ...size },
  );
}
