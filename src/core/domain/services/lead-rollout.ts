import { DomainError } from "@/domain/errors/domain-error";

/**
 * Module 159 — LEAD_V1 rollout controls: the pure, deterministic core.
 *
 * Nothing here reads an environment variable, a clock or a database. The single operator-facing switch is
 * `LEAD_V1_ROLLOUT_MODE`; this file defines its vocabulary, how a raw value is interpreted, and which AREA of activity each
 * mode opens.
 *
 * WHAT THIS IS. A rollout / kill switch: it decides whether NEW LEAD_V1 activity may start at all.
 *
 * WHAT THIS IS NOT. It is not authorization (who may act), not consent or privacy policy (M158), not pricing (M132/M133), not
 * eligibility (M147), not fraud/abuse control (M156) and not a legal or refund policy. Opening an area never grants anything: every
 * existing validation and policy gate still runs after the switch. Closing an area never touches existing rights: purchases,
 * contact access of CONFIRMED buyers, payments already in flight, refunds, credit notes, invoices, claims, disputes, revocations,
 * reconciliation, the audit trail and the M158 retention follow-through are NOT governed by this switch.
 */

/** The environment variable read by the infrastructure loader (kept here so docs, loader and tests share one spelling). */
export const LEAD_ROLLOUT_MODE_ENV = "LEAD_V1_ROLLOUT_MODE";

/**
 * DISABLED       (default) no NEW LEAD_V1 activity of either area.
 * ENTRY_ONLY     customers may create / publish requests; professionals may not browse or start purchases / payments.
 * PURCHASE_ONLY  drain mode: professionals may browse and buy ALREADY published leads; customers may not create / publish.
 * ENABLED        both areas open (every other gate still applies).
 *
 * One enum instead of several booleans: contradictory combinations cannot be expressed, and "off" has exactly one spelling.
 */
export const LEAD_ROLLOUT_MODES = ["DISABLED", "ENTRY_ONLY", "PURCHASE_ONLY", "ENABLED"] as const;
export type LeadRolloutMode = (typeof LEAD_ROLLOUT_MODES)[number];
export const DEFAULT_LEAD_ROLLOUT_MODE: LeadRolloutMode = "DISABLED";

/**
 * ENTRY     customer-side creation: submit a request, create the service request / lead, publish a lead.
 * PURCHASE  professional-side money activity: marketplace browsing (feed / list), purchase initiation, lead-fee payment initiation.
 */
export const LEAD_ROLLOUT_AREAS = ["ENTRY", "PURCHASE"] as const;
export type LeadRolloutArea = (typeof LEAD_ROLLOUT_AREAS)[number];

/**
 * DEFAULT        the variable is unset or empty: the documented safe default applies (DISABLED).
 * CONFIGURED     an exact mode name was supplied.
 * MISCONFIGURED  anything else (typo, wrong case, padding, a non-string): the SAME fail-safe outcome (DISABLED), but reported so
 *                that an operator can see the switch was not understood. It never degrades towards "enabled".
 */
export type LeadRolloutConfigStatus = "DEFAULT" | "CONFIGURED" | "MISCONFIGURED";

export interface LeadRolloutConfig {
  readonly mode: LeadRolloutMode;
  readonly status: LeadRolloutConfigStatus;
}

/** Exact, case-sensitive match; deliberately no trimming and no aliases ("true", "on", "1" are NOT ENABLED). */
export function parseLeadRolloutConfig(raw: unknown): LeadRolloutConfig {
  if (raw === undefined || raw === null || raw === "") return { mode: DEFAULT_LEAD_ROLLOUT_MODE, status: "DEFAULT" };
  if (typeof raw === "string" && (LEAD_ROLLOUT_MODES as readonly string[]).includes(raw)) {
    return { mode: raw as LeadRolloutMode, status: "CONFIGURED" };
  }
  return { mode: DEFAULT_LEAD_ROLLOUT_MODE, status: "MISCONFIGURED" };
}

/** The fail-safe configuration used whenever the switch cannot even be read. */
export const LEAD_ROLLOUT_UNAVAILABLE_CONFIG: LeadRolloutConfig = { mode: DEFAULT_LEAD_ROLLOUT_MODE, status: "MISCONFIGURED" };

const OPEN_AREAS: Readonly<Record<LeadRolloutMode, readonly LeadRolloutArea[]>> = {
  DISABLED: [],
  ENTRY_ONLY: ["ENTRY"],
  PURCHASE_ONLY: ["PURCHASE"],
  ENABLED: ["ENTRY", "PURCHASE"],
};

/** Total function: an unknown mode or area is closed. */
export function isLeadRolloutAreaOpen(mode: unknown, area: unknown): boolean {
  if (typeof mode !== "string" || typeof area !== "string") return false;
  const open = (OPEN_AREAS as Readonly<Record<string, readonly string[] | undefined>>)[mode];
  return open !== undefined && Object.prototype.hasOwnProperty.call(OPEN_AREAS, mode) && open.includes(area);
}

/** What the admin console and the logs show: never a value taken from the environment verbatim. */
export interface LeadRolloutStatusView {
  readonly mode: LeadRolloutMode;
  readonly status: LeadRolloutConfigStatus;
  readonly entryOpen: boolean;
  readonly purchaseOpen: boolean;
}

export function describeLeadRollout(config: LeadRolloutConfig): LeadRolloutStatusView {
  return {
    mode: config.mode,
    status: config.status,
    entryOpen: isLeadRolloutAreaOpen(config.mode, "ENTRY"),
    purchaseOpen: isLeadRolloutAreaOpen(config.mode, "PURCHASE"),
  };
}

/**
 * The uniform refusal. The message and code are identical for every blocked operation and every mode: they reveal neither which
 * area was closed nor why (disabled, misconfigured), and nothing about the configuration.
 */
export class LeadV1RolloutDisabledError extends DomainError {
  readonly code = "LEAD_V1_ROLLOUT_DISABLED";

  constructor() {
    super("This feature is not available right now.");
  }
}
