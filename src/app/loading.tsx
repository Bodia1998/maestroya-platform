/**
 * Root loading UI, shown automatically by Next.js while a Server
 * Component's async work (data fetching) is in flight — no manual
 * Suspense wiring needed at this level.
 */
export default function Loading() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-foreground" />
    </main>
  );
}
