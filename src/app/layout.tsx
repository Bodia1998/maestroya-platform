import type { Metadata } from "next";
import { getLocale, getMessages } from "next-intl/server";

import { getCurrentUser } from "@/infrastructure/auth/rbac";
import type { Locale } from "@/shared/i18n/locales";

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
  const [locale, messages, user] = await Promise.all([
    getLocale(),
    getMessages(),
    getCurrentUser(),
  ]);
  // `getLocale()` is typed as `string` (next-intl's `Locale` defaults to
  // `string` without an `AppConfig` type augmentation) — safe to narrow
  // here because `src/i18n/request.ts`'s `getRequestConfig` only ever
  // returns a member of `SUPPORTED_LOCALES`.
  const typedLocale = locale as Locale;

  return (
    <html lang={typedLocale} suppressHydrationWarning>
      <body>
        <Providers locale={typedLocale} messages={messages} isAuthenticated={Boolean(user)}>
          {children}
        </Providers>
      </body>
    </html>
  );
}
