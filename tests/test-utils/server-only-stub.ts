/**
 * Test-only no-op stand-in for the `server-only` package (Module 25 —
 * Production Infrastructure).
 *
 * `server-only`'s real implementation throws unless a bundler-specific
 * `react-server` resolve condition is active (see env.ts's own doc
 * comment) — a condition Next.js's webpack build sets for its server
 * module graph, but that plain Node.js/Vite module resolution (what
 * Vitest uses) never sets. Aliased in `vitest.config.ts` so that
 * importing genuinely server-only modules (env.ts, the observability
 * modules, auth-config.ts, etc.) from a server-side unit/integration
 * test — the normal, correct way to test them — does not trip the same
 * guard meant to catch an *actual* accidental client-bundle import.
 *
 * Deliberately does nothing.
 */
export {};
