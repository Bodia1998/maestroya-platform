import "server-only";

import { z } from "zod";

/**
 * Validated, typed environment configuration.
 *
 * Import `env` instead of reading `process.env` directly anywhere else in
 * the codebase. This is the single boundary where untyped, unvalidated
 * environment input is converted into a trustworthy shape — consistent
 * with Clean Architecture's principle of validating at the edges.
 *
 * Fails fast and loudly at startup if a required variable is missing or
 * malformed, rather than surfacing as a confusing runtime error later
 * (Module 25 — Production Infrastructure).
 *
 * Server-only boundary: this module reads secrets (DB credentials, OAuth
 * secrets, Stripe keys, Cloudinary API secret, the Auth.js secret). It
 * must never be imported from a Client Component or any code that ends up
 * in the browser bundle.
 *
 * This is enforced via the `server-only` package rather than a runtime
 * `typeof window !== "undefined"` check. That check was tried first and
 * reverted — Vitest's `jsdom` test environment defines a global `window`
 * for *every* test file regardless of whether the code under test is
 * server-only or client-only, so the check fired as a false positive for
 * any test that merely imported this module (or anything that transitively
 * imports it) on the server side, which is the normal, correct way to unit
 * test server-only code. `typeof window` cannot distinguish "really running
 * in a browser" from "running in a test environment that happens to define
 * `window`".
 *
 * `server-only` instead enforces the boundary at the framework/bundler
 * level: Next.js's webpack build sets a `react-server` resolve condition
 * for the entire server module graph (Server Components, Route Handlers,
 * Server Actions), which makes `server-only`'s package.json `exports`
 * map resolve to a no-op file there — but resolves to a throwing
 * implementation for any module reachable from the *client* bundle
 * (where that condition is absent), which is the actual boundary this
 * guards. Outside of Next's own bundler — e.g. under plain Node.js
 * module resolution, which is what Vitest uses — neither condition is
 * active and `server-only` falls back to its throwing implementation
 * too. `vitest.config.ts` therefore aliases `server-only` to an explicit
 * no-op stub (`tests/test-utils/server-only-stub.ts`) so importing
 * server-only code from a server-side unit test — a legitimate, intended
 * use — doesn't trip the same guard meant for an actual client bundle.
 */

const isProductionRuntime = process.env.NODE_ENV === "production";

/**
 * Base schema, shared across environments. Secrets that are hard
 * requirements in production (Stripe, Cloudinary) are still required in
 * every environment today because there is no environment-specific
 * wiring to make them optional in dev without touching unrelated modules
 * (Payment/Stripe Connect — Module 12 — and Storage) — this preserves
 * that existing behavior. What Module 25 adds on top is: stricter shape
 * validation (URLs, enums, numeric bounds) and additional
 * production-only checks (see `.superRefine` below) that only reject
 * genuinely unsafe production configuration, never dev/test.
 */
const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

    // --- App ---
    NEXT_PUBLIC_APP_URL: z.string().url(),

    // --- Observability ---
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

    // --- Database (PostgreSQL via Prisma) ---
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    // --- Email (Resend) ---
    RESEND_API_KEY: z.string().min(1, "RESEND_API_KEY is required"),
    EMAIL_FROM: z.string().min(1, "EMAIL_FROM is required"),

    // --- Auth.js ---
    AUTH_SECRET: z.string().min(1, "AUTH_SECRET is required"),
    AUTH_URL: z.string().url(),
    // Required for Auth.js v5 when self-hosting behind a reverse proxy
    // (Docker/any non-Vercel host) rather than Vercel's own platform
    // integration — see auth-config.ts's `trustHost`.
    AUTH_TRUST_HOST: z
      .enum(["true", "false"])
      .default("true")
      .transform((v) => v === "true"),

    // Optional: OAuth providers can be configured selectively. A provider
    // with an empty clientId/clientSecret simply won't work at sign-in time
    // rather than crashing the app at startup — useful for local dev with
    // only email/password configured.
    AUTH_GOOGLE_ID: z.string().optional(),
    AUTH_GOOGLE_SECRET: z.string().optional(),
    AUTH_APPLE_ID: z.string().optional(),
    AUTH_APPLE_SECRET: z.string().optional(),
    AUTH_FACEBOOK_ID: z.string().optional(),
    AUTH_FACEBOOK_SECRET: z.string().optional(),

    // --- Stripe Connect (Module 12 owns the business logic; this module
    // only validates that the client can be constructed safely) ---
    STRIPE_SECRET_KEY: z.string().min(1, "STRIPE_SECRET_KEY is required"),
    STRIPE_PUBLISHABLE_KEY: z.string().min(1, "STRIPE_PUBLISHABLE_KEY is required"),
    STRIPE_WEBHOOK_SECRET: z.string().min(1, "STRIPE_WEBHOOK_SECRET is required"),
    STRIPE_CONNECT_CLIENT_ID: z.string().optional(),

    // --- Cloudinary ---
    CLOUDINARY_CLOUD_NAME: z.string().min(1, "CLOUDINARY_CLOUD_NAME is required"),
    CLOUDINARY_API_KEY: z.string().min(1, "CLOUDINARY_API_KEY is required"),
    CLOUDINARY_API_SECRET: z.string().min(1, "CLOUDINARY_API_SECRET is required"),

    // --- Distributed rate limiting (optional — Module 25) ---
    // Not required today: the only wired-up `RateLimitRepository` is
    // in-memory (see infrastructure/security/in-memory-rate-limit-repository.ts),
    // which is correct for this codebase's current single-instance
    // deployment shape. Validated here (URL shape only, never connected
    // to an actual client by this module) so a future Redis-backed
    // implementation has a ready, validated place to read its connection
    // string from without another env-layer change. See
    // docs/MODULE_25_PRODUCTION_INFRASTRUCTURE.md, "Distributed rate
    // limiting".
    REDIS_URL: z.string().url().optional(),

    // --- Geocoding provider (Module 27 — Spain Location Services) ---
    // Selects which `GeocodingProvider` implementation
    // `createGeocodingProvider()` (infrastructure/geocoding/geocoding-provider-factory.ts)
    // constructs. Defaults to `STATIC` — the network-free
    // `StaticCityGeocodingProvider` — via `.catch()`, not just
    // `.default()`: `.catch()` also swallows an *invalid* value (a typo, a
    // stray value left over from another environment) and falls back to
    // `STATIC` instead of throwing and failing the entire app's startup
    // over a misconfigured, non-critical setting. This is the hard
    // guarantee behind "the application must never accidentally call a
    // real external API" — no outbound geocoding HTTP request can ever
    // happen unless `GEOCODING_PROVIDER` is deliberately, validly set to
    // `MAPBOX`/`GOOGLE`/`HERE`/`OSM` *and* (for the first three) the
    // matching API key is non-empty; every other case — unset, empty,
    // misspelled, or a real provider without its key — resolves to
    // `STATIC` at either this layer or the factory's own fallback (see
    // `geocoding-provider-factory.ts`), never a startup crash and never a
    // silent real network call.
    GEOCODING_PROVIDER: z.enum(["STATIC", "MAPBOX", "GOOGLE", "HERE", "OSM"]).catch("STATIC"),
    // API keys for the providers above. Deliberately optional and allowed
    // to be empty in every environment (including production) — there is
    // no production key yet, and requiring one here would make the app
    // fail to start over a provider that isn't even selected. OSM
    // (Nominatim) needs no key at all.
    MAPBOX_API_KEY: z.string().optional(),
    GOOGLE_GEOCODING_API_KEY: z.string().optional(),
    HERE_API_KEY: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV !== "production") return;

    // `next build` unconditionally forces NODE_ENV=production for the
    // build itself (that's how Next.js produces an optimized bundle),
    // even when the actual deploy target is CI or a preview environment
    // running on placeholder secrets — see .github/workflows/ci.yml.
    // `NEXT_PHASE` is Next's own build-phase marker (`phase-production-build`
    // during `next build`, unset during `next start`/actual request
    // handling), so this only skips the *strict* production checks below
    // during the build step itself. Every other validation above (types,
    // URL shape, required-ness) still applies at build time; only the
    // "is this a real, safely-configured production deployment" checks
    // are deferred to actual server startup, where the real environment
    // is guaranteed to be present.
    if (process.env.NEXT_PHASE === "phase-production-build") return;

    // Never let a production deployment start on an accidentally weak or
    // placeholder secret — a common source of real-world session/CSRF
    // compromises. 32 chars matches `openssl rand -base64 32` / `npx auth
    // secret` output length.
    if (value.AUTH_SECRET.length < 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["AUTH_SECRET"],
        message: "AUTH_SECRET must be at least 32 characters in production.",
      });
    }

    // Production traffic must be served over HTTPS for secure cookies,
    // HSTS, and OAuth redirect URIs to behave correctly.
    if (!value.NEXT_PUBLIC_APP_URL.startsWith("https://")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["NEXT_PUBLIC_APP_URL"],
        message: "NEXT_PUBLIC_APP_URL must use https:// in production.",
      });
    }
    if (!value.AUTH_URL.startsWith("https://")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["AUTH_URL"],
        message: "AUTH_URL must use https:// in production.",
      });
    }

    if (
      value.STRIPE_SECRET_KEY.startsWith("sk_test_") ||
      value.STRIPE_PUBLISHABLE_KEY.startsWith("pk_test_")
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["STRIPE_SECRET_KEY"],
        message: "Test-mode Stripe keys (sk_test_/pk_test_) must not be used in production.",
      });
    }
  });

function parseEnv() {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    // Field names only — never log the values themselves, some of which
    // are the very secrets this validation exists to protect.
    const fieldErrors = parsed.error.flatten().fieldErrors;
    // Startup-time fatal diagnostic, necessarily precedes logger.ts's own
    // init (which itself depends on `env` being valid) — a plain
    // console.error is the correct tool here, not a gap.
    console.error("Invalid environment configuration. Affected variables:", Object.keys(fieldErrors));
    console.error(fieldErrors);
    throw new Error(
      "Invalid environment variables — see log above. The application cannot start safely.",
    );
  }

  return parsed.data;
}

export const env = parseEnv();
export type Env = z.infer<typeof envSchema>;

export const isProduction = env.NODE_ENV === "production";
export const isDevelopment = env.NODE_ENV === "development";
export const isTest = env.NODE_ENV === "test";

// Re-exported for readability at call sites that only care about the
// process's declared NODE_ENV before `env` has necessarily been imported
// (e.g. very early startup diagnostics). Prefer `isProduction`/`env.NODE_ENV`
// once `env` is available.
export { isProductionRuntime };
