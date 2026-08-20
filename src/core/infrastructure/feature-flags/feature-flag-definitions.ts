import "server-only";

import type { FeatureFlagDefinition } from "@/domain/entities/feature-flag";
import { featureFlagsConfigSchema } from "@/application/dto/feature-flag.dto";
import { logger } from "@/infrastructure/observability/logger";

/**
 * Feature Flags module — the code-defined default catalog.
 *
 * Every flag the platform ships with today, defined in code (reviewed,
 * versioned, deployed like everything else) rather than requiring an
 * operator to seed one via `FEATURE_FLAGS_CONFIG`/a future admin UI just
 * to get a working default. `ConfigFeatureFlagProvider`
 * (`config-feature-flag-provider.ts`) seeds its in-memory store from this
 * list, then applies `FEATURE_FLAGS_CONFIG` on top (see
 * `mergeFeatureFlagDefinitions` below).
 *
 * Kept intentionally minimal — this is the extension point new features
 * add an entry to when they want a flag, not a place that accumulates
 * every flag ever created (a flag whose rollout finished and is now
 * permanently on should simply be removed here and its guard deleted from
 * the call site, the normal feature-flag lifecycle).
 */
export const DEFAULT_FEATURE_FLAG_DEFINITIONS: readonly FeatureFlagDefinition[] = [
  // Example flag, demonstrating the full shape this module supports.
  // Disabled by default and scoped out of production — safe to leave in
  // place; remove once a real flag takes its place, or delete entirely.
  {
    key: "example-feature-flag",
    description:
      "Demonstration flag for the Feature Flags module — safe to remove once a real flag exists. " +
      "Shows rollout percentage, user/role targeting, and environment scoping together.",
    enabled: true,
    environments: ["development", "test"],
    rollout: { percentage: 0 },
    targeting: { roleAllowList: ["ADMIN", "SUPER_ADMIN"] },
    metadata: { owner: "platform-team" },
  },
  // Module 73 — Real Customer Payment Capture: the required kill switch.
  // `InitiateQuotePaymentUseCase` checks this before ever calling
  // `PaymentGateway.authorize` (see that use case's own doc comment) — an
  // operator can flip `enabled: false` (via a future admin UI/
  // `FEATURE_FLAGS_CONFIG` override, same as any other flag here) to stop
  // *new* payment initiation immediately, with zero deploy, while every
  // already-created Stripe PaymentIntent keeps flowing through
  // `ProcessCustomerPaymentWebhookUseCase` completely unaffected —
  // `evaluate()` is never consulted by webhook processing, only by the
  // initiation use case, so disabling this can never corrupt an
  // in-flight payment or silently stop already-scheduled webhook
  // deliveries from being processed. No rollout/targeting restriction —
  // `enabled: true` in every environment is the normal, fully-on state;
  // this flag exists purely as the emergency-stop lever the module brief
  // requires, not as a staged rollout mechanism.
  {
    key: "customer-payment-capture",
    description:
      "Kill switch for new customer payment initiation (Module 73). Disabling this blocks only " +
      "InitiateQuotePaymentUseCase — already-created Stripe PaymentIntents and webhook processing are unaffected.",
    enabled: true,
  },
];

/**
 * Parses and validates the raw `FEATURE_FLAGS_CONFIG` env value (a JSON
 * array of flag definitions). Never throws: malformed JSON or a
 * schema-invalid entry is logged at `warn` and treated as "no override
 * config" — the same "a misconfigured operational setting degrades to the
 * safe default, never fails startup" rule every other JSON-ish env var in
 * `infrastructure/config/env.ts` follows (see e.g.
 * `OTEL_EXPORTER_HEADERS`'s `parseExporterHeaders`).
 */
export function parseFeatureFlagsConfig(raw: string | undefined): FeatureFlagDefinition[] {
  if (!raw) return [];

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (error) {
    logger.warn("feature_flags.config_invalid_json", { error: error instanceof Error ? error.message : String(error) });
    return [];
  }

  const result = featureFlagsConfigSchema.safeParse(parsedJson);
  if (!result.success) {
    logger.warn("feature_flags.config_invalid_shape", {
      issues: result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    });
    return [];
  }

  return result.data;
}

/**
 * Merges `overrides` onto `defaults` by `key` — an override *replaces* the
 * matching default entirely (never a deep-merge of individual fields),
 * the same "whole definition, not a patch" semantics
 * `FeatureFlagProvider.upsertDefinition` documents. An override for a key
 * not present in `defaults` is simply added.
 */
export function mergeFeatureFlagDefinitions(
  defaults: readonly FeatureFlagDefinition[],
  overrides: readonly FeatureFlagDefinition[],
): FeatureFlagDefinition[] {
  const byKey = new Map<string, FeatureFlagDefinition>();
  for (const definition of defaults) byKey.set(definition.key, definition);
  for (const definition of overrides) byKey.set(definition.key, definition);
  return Array.from(byKey.values());
}
