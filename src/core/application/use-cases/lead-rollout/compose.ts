import { LeadRolloutGuarded } from "@/application/use-cases/lead-rollout/lead-rollout-guard";
import {
  LEAD_ROLLOUT_UNAVAILABLE_CONFIG,
  describeLeadRollout,
  type LeadRolloutArea,
  type LeadRolloutConfig,
  type LeadRolloutStatusView,
} from "@/domain/services/lead-rollout";
import { loadLeadRolloutConfig } from "@/infrastructure/config/lead-rollout-config";

/**
 * Module 159 — composition root of the LEAD_V1 rollout controls (plain factories, no DI container).
 *
 * `guardLeadV1Entry` / `guardLeadV1Purchase` are the ONLY places the switch attaches to the application. Each returns a guard that
 * ALWAYS wraps (there is deliberately no "mode OFF returns the original object" shortcut as in M156: the default here is DISABLED,
 * i.e. the safe state must be the enforced one) and reads the environment on every call.
 *
 * What is wrapped (and, equally important, what is NOT):
 *   ENTRY    SubmitLeadRequest, CreateLeadV1ServiceRequest, CreateLead, PublishLead.
 *   PURCHASE LeadFeed, published-lead preview list, InitiateLeadPurchase, InitiateLeadFeePayment.
 *   NEVER    webhook confirmation / disputes (M141/M155), contact access of CONFIRMED buyers (M138), the single-lead preview and the
 *            checkout state read (needed by existing purchases), refunds / credit notes / invoices / reconciliation (M149–M153),
 *            claims (M154), revocation, the admin console (M157), consent withdrawal and the retention cron (M158).
 */
export function guardLeadV1Entry<A extends unknown[], R>(
  inner: { execute(...args: A): Promise<R> },
  readConfig: () => LeadRolloutConfig = () => loadLeadRolloutConfig(),
) {
  return new LeadRolloutGuarded<A, R>(inner, "ENTRY", readConfig);
}

export function guardLeadV1Purchase<A extends unknown[], R>(
  inner: { execute(...args: A): Promise<R> },
  readConfig: () => LeadRolloutConfig = () => loadLeadRolloutConfig(),
) {
  return new LeadRolloutGuarded<A, R>(inner, "PURCHASE", readConfig);
}

/** Read-only view for the admin console (M157 "kill-switch visibility"). Never throws. */
export function getLeadRolloutStatus(readConfig: () => LeadRolloutConfig = () => loadLeadRolloutConfig()): LeadRolloutStatusView {
  try {
    return describeLeadRollout(readConfig());
  } catch {
    return describeLeadRollout(LEAD_ROLLOUT_UNAVAILABLE_CONFIG);
  }
}

export type { LeadRolloutArea };
