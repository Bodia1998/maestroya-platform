import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";

import { getCurrentUser, ROLES } from "@/infrastructure/auth/rbac";
import { getMessages, selectClientMessages } from "@/infrastructure/i18n/message-loader";
import type { Locale } from "@/shared/i18n/locales";
import { JsonLd } from "@/components/seo/json-ld";
import { SITE_KEYWORDS, SITE_NAME, SITE_URL, toOgLocale } from "@/shared/seo/site";
import { buildOrganizationJsonLd, buildWebSiteJsonLd } from "@/shared/seo/structured-data";

import { Providers } from "./providers";

import "./globals.css";

/**
 * Module 43 — SEO Infrastructure: site-wide metadata defaults, inherited
 * by every route unless it defines its own (Next's Metadata API merges a
 * child segment's `metadata`/`generateMetadata` over these, field by
 * field — see the Next.js docs on metadata merging). Per-page overrides
 * live next to each page (see `(marketing)/**\/page.tsx`,
 * `(marketing)/professionals/[id]/page.tsx`,
 * `(marketing)/companies/[id]/page.tsx`).
 *
 * `metadataBase` is what lets every other `Metadata` field below and in
 * every child route use a site-relative path (`"/professionals"`,
 * `"/opengraph-image"`) instead of repeating `SITE_URL` everywhere — Next
 * resolves them against this base at render time.
 *
 * Module 120 — Multilingual Localization: title/description/Open Graph
 * text and `og:locale` follow the visitor's negotiated locale (`seo`
 * namespace, server-only). Every page keeps ONE canonical URL whose
 * language is chosen per visitor (cookie / account / Accept-Language, no
 * `/en/…` or `?lang=`), so NO `alternates.languages` (hreflang) entries
 * are emitted: hreflang must point at distinct URLs that serve each
 * language, and none exist — pointing every language at the same URL
 * would be self-contradictory. A crawler that sends no cookie and no
 * Accept-Language gets the Spanish default, which is the canonical
 * indexed content.
 */
export async function generateMetadata(): Promise<Metadata> {
  const [t, locale] = await Promise.all([getTranslations("seo"), getLocale()]);
  const defaultTitle = t("site.defaultTitle");
  const description = t("site.description");
  return {
    metadataBase: new URL(SITE_URL),
    title: {
      default: defaultTitle,
      template: `%s | ${SITE_NAME}`,
    },
    description,
    keywords: SITE_KEYWORDS,
    authors: [{ name: SITE_NAME, url: SITE_URL }],
    creator: SITE_NAME,
    publisher: SITE_NAME,
    alternates: {
      canonical: "/",
    },
    // Default, permissive crawl policy — individual auth/dashboard routes
    // never reach this far (see `middleware.ts`'s `PROTECTED_PREFIXES`) and
    // are additionally excluded via `src/app/robots.ts`'s `disallow` list;
    // this default only governs the public marketing/discovery pages that
    // actually render.
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-image-preview": "large",
        "max-snippet": -1,
      },
    },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      title: defaultTitle,
      description,
      url: "/",
      locale: toOgLocale(locale),
    },
    twitter: {
      card: "summary_large_image",
      title: defaultTitle,
      description,
    },
    icons: {
      icon: "/icon",
      apple: "/apple-icon",
    },
    manifest: "/manifest.webmanifest",
  };
}

/**
 * Root layout — a Server Component (no "use client" directive), per the
 * project's Server-Components-by-default rule. It renders the one client
 * boundary (`Providers`) around server-rendered children.
 *
 * Module 29 — Internationalization: this is the single place the request's
 * interface language is resolved and handed to the client tree, via
 * next-intl's own `getLocale()`/`getMessages()` (`next-intl/server`),
 * which read the resolution `src/i18n/request.ts`'s `getRequestConfig`
 * already ran for this request (cookie/DB/`Accept-Language` — see that
 * file). Two consequences worth knowing about:
 *
 * - `<html lang>` is no longer hardcoded to `"es"`. It now reflects the
 *   actual language of the rendered document, which is what screen
 *   readers switch voice on and what browsers offer translation from.
 * - Resolving the locale reads cookies/headers (and, for a signed-in
 *   user, one indexed row), which opts the tree into dynamic rendering.
 *   That is the unavoidable cost of *not* putting the locale in the URL —
 *   see middleware.ts's `negotiateLocale` doc comment for why that
 *   trade-off was made deliberately.
 */
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [locale, user] = await Promise.all([getLocale(), getCurrentUser()]);
  // `getLocale()` is typed as `string` (next-intl's `Locale` defaults to
  // `string` without an `AppConfig` type augmentation) — safe to narrow
  // here because `src/i18n/request.ts`'s `getRequestConfig` only ever
  // returns a member of `SUPPORTED_LOCALES`.
  const typedLocale = locale as Locale;
  // Module 120: same fallback-merged catalog `src/i18n/request.ts` hands
  // next-intl, minus server-only namespaces (and minus `admin` for
  // non-admins) — see `selectClientMessages`.
  const isAdmin =
    user?.roles?.some((role) => role === ROLES.ADMIN || role === ROLES.SUPER_ADMIN) ?? false;
  const messages = selectClientMessages(getMessages(typedLocale), { includeAdmin: isAdmin });

  return (
    <html lang={typedLocale} suppressHydrationWarning>
      <body>
        {/* Module 43 — SEO Infrastructure: site-wide structured data,
            emitted once per page load regardless of route — Organization
            and WebSite are properties of the platform itself, not of any
            one page. Per-page structured data (BreadcrumbList,
            ProfessionalService/LocalBusiness) is emitted by the pages
            that own that data instead. */}
        <JsonLd data={buildOrganizationJsonLd()} />
        <JsonLd data={buildWebSiteJsonLd()} />
        <Providers locale={typedLocale} messages={messages} isAuthenticated={Boolean(user)}>
          {children}
        </Providers>
      </body>
    </html>
  );
}
