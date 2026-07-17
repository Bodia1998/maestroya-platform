import type { Metadata } from "next";

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
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
