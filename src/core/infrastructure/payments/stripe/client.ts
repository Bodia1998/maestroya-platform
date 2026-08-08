import "server-only";

import Stripe from "stripe";

import { env } from "@/infrastructure/config/env";
import { isTracingEnabled } from "@/infrastructure/tracing/compose";
import { createTracedFetch } from "@/infrastructure/tracing/traced-fetch";

/**
 * Stripe client singleton — server-side only, never import from a Client
 * Component.
 *
 * This project uses Stripe Connect (not plain Stripe Checkout) because
 * MaestroYa is a two-sided marketplace: payments need to be split between
 * the platform and individual service providers. Connect-specific logic
 * (onboarding links, transfers, application fees) belongs in dedicated
 * use cases under src/core/application/use-cases once payment features
 * are built — this file only exposes the configured client.
 */
/**
 * Module 51 — Distributed Tracing: Stripe's SDK has its own pluggable
 * `httpClient`, and `Stripe.createFetchHttpClient(fetchFn)` accepts any
 * `fetch`-compatible function — so the traced `fetch`
 * (`infrastructure/tracing/traced-fetch.ts`) drops straight in, giving a
 * `client` span for every Stripe API call with no wrapper around the
 * hundreds of resource methods the SDK exposes.
 *
 * Only applied when tracing is enabled: passing *any* `httpClient`
 * switches Stripe off its default Node HTTP client, so leaving the option
 * off entirely on the disabled path guarantees the SDK behaves exactly as
 * it always has (connection reuse, retries, timeouts — all Stripe's own
 * defaults) rather than "as it does under a fetch-based client".
 */
export const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
  apiVersion: "2025-02-24.acacia",
  typescript: true,
  ...(isTracingEnabled()
    ? { httpClient: Stripe.createFetchHttpClient(createTracedFetch("stripe")) }
    : {}),
});
