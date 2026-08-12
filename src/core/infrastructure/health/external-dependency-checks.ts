import "server-only";

import { env } from "@/infrastructure/config/env";

/**
 * Module 56 — Health Checks & Circuit Breakers.
 *
 * Requirement 3 names external integrations this codebase does not yet
 * have a dedicated `*-health.ts` for: Stripe, Cloudinary, Resend,
 * Twilio, and the OpenTelemetry OTLP collector (`checks.tracing`
 * already reports the *SDK's* health — export success/failure — but not
 * the collector endpoint's own configuration in isolation). Each check
 * below reports configuration/credential presence, deliberately not a
 * live network call to the provider — the same "no outbound call can
 * happen unless deliberately and completely configured, and never as a
 * side effect of a health check" principle `GEOCODING_PROVIDER`/
 * `SEARCH_PROVIDER` already establish in `env.ts`, applied to a context
 * (a health check polled far more often than a real request) where an
 * unconditional live call would add real cost and rate-limit exposure
 * for zero business value.
 *
 * Each is still executed through its own dedicated `CircuitBreaker` (see
 * `infrastructure/health/compose.ts`), which is what makes this the
 * correct *extension point* for a future real ping (Requirement 3's
 * "Future external APIs"): swapping the body of any one `collect*`
 * function below for a real, lightweight provider call (e.g. Stripe's
 * `balance.retrieve`) is the only change ever required — the breaker,
 * the contributor adapter, and every consumer of `HealthContributor`
 * stay identical.
 */

export function collectStripeHealth() {
  const configured = Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_PUBLISHABLE_KEY);
  return {
    status: configured ? "ok" : "unavailable",
    configured,
    connectEnabled: Boolean(env.STRIPE_CONNECT_CLIENT_ID),
    mode: env.STRIPE_SECRET_KEY.startsWith("sk_live_") ? "live" : "test",
  };
}

export function collectCloudinaryHealth() {
  const configured = Boolean(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET);
  return { status: configured ? "ok" : "unavailable", configured };
}

export function collectResendHealth() {
  const configured = Boolean(env.RESEND_API_KEY && env.EMAIL_FROM);
  return { status: configured ? "ok" : "unavailable", configured, from: env.EMAIL_FROM };
}

export function collectTwilioHealth() {
  if (env.SMS_PROVIDER !== "twilio") {
    return { status: "disabled", configured: false, provider: env.SMS_PROVIDER };
  }
  const configured = Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER);
  return { status: configured ? "ok" : "degraded", configured, provider: "twilio" };
}

export function collectOpenTelemetryCollectorHealth() {
  if (env.TRACING_ENABLED !== "true") {
    return { status: "disabled", enabled: false, exporter: env.TRACING_EXPORTER };
  }
  if (env.TRACING_EXPORTER === "otlp" && !env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    return { status: "degraded", enabled: true, exporter: env.TRACING_EXPORTER, reason: "OTEL_EXPORTER_OTLP_ENDPOINT not configured" };
  }
  return { status: "ok", enabled: true, exporter: env.TRACING_EXPORTER };
}
