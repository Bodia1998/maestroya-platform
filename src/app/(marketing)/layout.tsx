/**
 * Layout for public marketing routes (homepage, service category pages,
 * etc. once built). Kept separate from (dashboard) so authenticated-app
 * chrome (sidebar, account menu) never leaks into public pages, and vice
 * versa — the route group has no URL segment of its own.
 */
export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
