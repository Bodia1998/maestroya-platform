"use client";

/**
 * Root error boundary — MUST be a Client Component (App Router
 * requirement; error boundaries rely on React state, which needs
 * client-side rendering).
 *
 * Module 39 — Sentry + CI/CD Hardening: reports the caught error to
 * Sentry's browser SDK when `NEXT_PUBLIC_SENTRY_DSN` is configured
 * (production only — see `infrastructure/config/env.ts`). Deliberately
 * does not import `@/infrastructure/config/env` or any other
 * `server-only`-guarded module (this file runs in the browser); reads
 * `process.env.NEXT_PUBLIC_SENTRY_DSN` directly, the standard Next.js way
 * to reference a `NEXT_PUBLIC_*` variable from client code, and the SDK
 * is only ever loaded when that value is present. Falls back to
 * `console.error` (unchanged from before this module) whenever the DSN
 * is unset, so local development needs no Sentry account or network
 * access at all.
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

    const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
    if (!dsn) return;

    void import("@sentry/nextjs")
      .then((Sentry) => {
        Sentry.captureException(error);
      })
      .catch(() => {
        // Sentry's browser SDK failing to load must never break the
        // error boundary itself — `console.error` above already ran.
      });
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
