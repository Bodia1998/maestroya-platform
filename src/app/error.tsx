"use client";

/**
 * Root error boundary — MUST be a Client Component (App Router
 * requirement; error boundaries rely on React state, which needs
 * client-side rendering).
 *
 * Kept minimal here. Add error reporting (Sentry or similar) inside the
 * useEffect once an observability provider is chosen.
 */
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <button
        onClick={reset}
        className="rounded-md border border-border px-4 py-2 text-sm"
      >
        Try again
      </button>
    </main>
  );
}
