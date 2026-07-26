import "server-only";

import Stripe from "stripe";

import { env } from "@/infrastructure/config/env";

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
export const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
  apiVersion: "2025-02-24.acacia",
  typescript: true,
});
