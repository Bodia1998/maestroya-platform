import { SiteFooter } from "@/presentation/components/shared/site-footer";
import { SiteHeader } from "@/presentation/components/shared/site-header";

/**
 * Layout for public marketing routes (homepage, search, professional
 * directory, public profiles). Kept separate from (dashboard) so
 * authenticated-app chrome never leaks into public pages, and vice versa
 * — the route group has no URL segment of its own.
 *
 * `SiteHeader` is an async Server Component (it reads the session), so
 * this layout stays a Server Component too — no "use client" needed here.
 */
export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
