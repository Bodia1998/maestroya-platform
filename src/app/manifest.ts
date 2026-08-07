import type { MetadataRoute } from "next";

import { SITE_DESCRIPTION, SITE_NAME } from "@/shared/seo/site";

/**
 * Module 43 — SEO Infrastructure: Web App Manifest, served at
 * `/manifest.webmanifest` via Next's `manifest.ts` file convention (see
 * `src/app/layout.tsx`'s `metadata.manifest`, which points at it).
 * Improves installability/"Add to Home Screen" and gives search engines
 * (Google in particular) a canonical app name/theme color signal — a
 * standard, low-cost piece of production SEO/PWA hygiene independent of
 * whether the platform ever ships a full PWA experience.
 *
 * Icons point at the generated `/icon` and `/apple-icon` routes (see
 * those files' own doc comments for why they're generated rather than
 * static assets) rather than duplicating a second icon pipeline here.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#1954B4",
    icons: [
      { src: "/icon", sizes: "32x32", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
