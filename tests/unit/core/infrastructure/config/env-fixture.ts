/**
 * Shared helpers for testing env.ts (Module 25 — Production
 * Infrastructure).
 *
 * env.ts validates `process.env` as a module-level side effect at import
 * time (`export const env = parseEnv()`) — that's the whole point (fail
 * fast at startup), but it means testing different env configurations
 * requires resetting the module registry and re-importing between
 * cases, rather than importing `env` once at the top of the test file.
 */
import { vi } from "vitest";

export const VALID_BASE_ENV: Record<string, string> = {
  NODE_ENV: "development",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/maestroya?schema=public",
  // Email (Resend) — required since env.ts started validating these
  // (commit 82fb6d1, "fix(auth): improve email verification and password
  // reset"); RegisterUserUseCase/RequestPasswordResetUseCase now import
  // `env` directly to send real verification/reset emails via Resend.
  RESEND_API_KEY: "re_test_placeholder",
  EMAIL_FROM: "MaestroYa <noreply@maestroya.test>",
  AUTH_SECRET: "dev-secret-does-not-need-32-chars",
  AUTH_URL: "http://localhost:3000",
  STRIPE_SECRET_KEY: "sk_test_placeholder",
  STRIPE_PUBLISHABLE_KEY: "pk_test_placeholder",
  STRIPE_WEBHOOK_SECRET: "whsec_placeholder",
  CLOUDINARY_CLOUD_NAME: "demo",
  CLOUDINARY_API_KEY: "123456",
  CLOUDINARY_API_SECRET: "abcdef",
};

const ENV_KEYS = [
  ...Object.keys(VALID_BASE_ENV),
  "LOG_LEVEL",
  "AUTH_TRUST_HOST",
  "AUTH_GOOGLE_ID",
  "AUTH_GOOGLE_SECRET",
  "AUTH_APPLE_ID",
  "AUTH_APPLE_SECRET",
  "AUTH_FACEBOOK_ID",
  "AUTH_FACEBOOK_SECRET",
  "STRIPE_CONNECT_CLIENT_ID",
  "REDIS_URL",
  "NEXT_PHASE",
  "GEOCODING_PROVIDER",
  "MAPBOX_API_KEY",
  "GOOGLE_GEOCODING_API_KEY",
  "HERE_API_KEY",
];

/**
 * Loads env.ts under a fully controlled `process.env`, isolated from
 * whatever the surrounding test process happens to have set. Returns the
 * imported module's exports, or throws the same error env.ts itself
 * would throw for invalid configuration — callers assert on either.
 */
export async function loadEnvWith(overrides: Record<string, string | undefined>) {
  const mutableEnv = process.env as Record<string, string | undefined>;
  const original: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) original[key] = mutableEnv[key];

  for (const key of ENV_KEYS) delete mutableEnv[key];
  for (const [key, value] of Object.entries({ ...VALID_BASE_ENV, ...overrides })) {
    if (value === undefined) delete mutableEnv[key];
    else mutableEnv[key] = value;
  }

  vi.resetModules();

  try {
    return await import("@/infrastructure/config/env");
  } finally {
    for (const key of ENV_KEYS) {
      if (original[key] === undefined) delete mutableEnv[key];
      else mutableEnv[key] = original[key];
    }
  }
}
