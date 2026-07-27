import path from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/unit/**/*.test.{ts,tsx}", "tests/integration/**/*.test.{ts,tsx}"],
    /**
     * Baseline `process.env` for every test file, applied before any test
     * runs. `env.ts` validates `process.env` as a module-load side effect
     * (`export const env = parseEnv()`), so *any* test that imports it —
     * even transitively, e.g. an auth use case or `rbac.ts` importing
     * `@/lib/auth` — needs a fully valid environment at import time, not
     * just the handful of tests that exercise `env.ts` directly via
     * `tests/unit/core/infrastructure/config/env-fixture.ts`.
     *
     * These are non-secret, dev-safe placeholder values — the same shape
     * `.env.example`/CI's `env:` block use — never production values.
     * `tests/.../env-fixture.ts`'s `loadEnvWith()` still fully controls
     * `process.env` for its own isolated test cases (it deletes and
     * resets every relevant key per call), so this baseline doesn't
     * interfere with those tests; it only fills the gap for tests that
     * never touch env.ts's fixture at all.
     */
    env: {
      NODE_ENV: "test",
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/maestroya_test?schema=public",
      RESEND_API_KEY: "re_test_placeholder",
      EMAIL_FROM: "MaestroYa <noreply@maestroya.test>",
      AUTH_SECRET: "vitest-baseline-secret-not-for-production-use",
      AUTH_URL: "http://localhost:3000",
      STRIPE_SECRET_KEY: "sk_test_placeholder",
      STRIPE_PUBLISHABLE_KEY: "pk_test_placeholder",
      STRIPE_WEBHOOK_SECRET: "whsec_placeholder",
      CLOUDINARY_CLOUD_NAME: "demo",
      CLOUDINARY_API_KEY: "123456",
      CLOUDINARY_API_SECRET: "abcdef",
    },
    server: {
      deps: {
        // next-auth ships native ESM and is normally left external so
        // Vitest loads it via Node's own ESM loader. But `next-auth/lib/env.js`
        // does `import { NextRequest } from "next/server"`, and Next.js'
        // package.json has no `exports` map (by design — see the
        // `@ts-expect-error` comment right above that import in next-auth's
        // source), so Node's strict ESM resolver refuses the extensionless
        // subpath ("Cannot find module .../next/server ... Did you mean to
        // import next/server.js?"). Forcing next-auth through Vite's own
        // resolver (which — unlike Node's native ESM loader — falls back to
        // probing file extensions for packages without an `exports` field)
        // resolves it to the real `next/server.js` file, exactly like
        // Next's own webpack build and a plain Node `require()` do.
        inline: ["next-auth"],
      },
    },
  },
  resolve: {
  alias: {
    // The real `server-only` package throws unless a bundler-specific
    // `react-server` resolve condition is active (see env.ts's own doc
    // comment) — a condition Next.js's webpack build sets, but Vite/
    // Vitest's plain module resolution never does. Aliased to a no-op
    // stub so server-only modules (env.ts, auth-config.ts, the
    // observability modules, etc.) can be imported from server-side
    // tests — the normal, correct way to test them — without tripping
    // the same guard meant to catch an actual client-bundle import.
    "server-only": path.resolve(__dirname, "./tests/test-utils/server-only-stub.ts"),
    "@/application": path.resolve(__dirname, "./src/core/application"),
    "@/domain": path.resolve(__dirname, "./src/core/domain"),
    "@/infrastructure": path.resolve(__dirname, "./src/core/infrastructure"),
    "@/presentation": path.resolve(__dirname, "./src/presentation"),
    "@/components": path.resolve(__dirname, "./src/presentation/components"),
    "@/hooks": path.resolve(__dirname, "./src/presentation/hooks"),
    "@/lib": path.resolve(__dirname, "./src/lib"),
    "@/shared": path.resolve(__dirname, "./src/shared"),
    "@": path.resolve(__dirname, "./src"),
  },
},
});
