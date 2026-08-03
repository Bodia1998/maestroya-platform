import type { Metadata } from "next";

import { getI18nBootstrap } from "@/infrastructure/i18n/server-locale";

import { Providers } from "./providers";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "MaestroYa",
    template: "%s | MaestroYa",
  },
  description: "Conecta con profesionales de confianza para tu hogar.",
};

/**
 * Root layout — a Server Component (no "use client" directive), per the
 * project's Server-Components-by-default rule. It renders the one client
 * boundary (`Providers`) around server-rendered children.
 *
 * Module 29 — Internationalization: this is the single place the request's
 * interface language is resolved (`getI18nBootstrap()` — cookie/DB/
 * `Accept-Language`, see server-locale.ts) and handed to the client tree.
 * Two consequences worth knowing about:
 *
 * - `<html lang>` is no longer hardcoded to `"es"`. It now reflects the
 *   actual language of the rendered document, which is what screen
 *   readers switch voice on and what browsers offer translation from.
 * - Resolving the locale reads cookies/headers (and, for a signed-in
 *   user, one indexed row), which opts the tree into dynamic rendering.
 *   That is the unavoidable cost of *not* putting the locale in the URL —
 *   see middleware.ts's `negotiateLocale` doc comment for why that
 *   trade-off was made deliberately, and
 *   docs/MODULE_29_INTERNATIONALIZATION.md §10 for the caching options
 *   left open.
 */
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { locale, messages, isAuthenticated } = await getI18nBootstrap();

  return (
    <html lang={locale} suppressHydrationWarning>
      <body>
        <Providers locale={locale} messages={messages} isAuthenticated={isAuthenticated}>
          {children}
        </Providers>
      </body>
    </html>
  );
}
