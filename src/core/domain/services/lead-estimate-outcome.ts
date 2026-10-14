import { DomainError } from "@/domain/errors/domain-error";
import { parseScaledDecimal } from "@/domain/services/fixed-point-decimal";

/**
 * Module 164 — recording the ACTUAL job value of a published lead's request: the raw material for validating estimates against
 * reality (see lead-estimate-accuracy.ts). Pure validation only.
 *
 * Nothing is inferred, estimated or backfilled: an outcome exists only because a person recorded a value. The legacy Quote / Job /
 * Payment tables are NOT a source (they are legacy financial rows and must not be reused for LEAD_V1). Until outcomes accumulate,
 * the 90% target cannot be tested and no accuracy figure may be claimed.
 */
export type LeadEstimateOutcomeRejection = "ACTOR_NOT_AUTHORIZED" | "INVALID_INPUT" | "LEAD_NOT_FOUND" | "LEAD_NOT_PUBLISHED" | "ALREADY_RECORDED";

export class LeadEstimateOutcomeRejectedError extends DomainError {
  readonly code = "LEAD_ESTIMATE_OUTCOME_REJECTED";

  constructor(readonly reason: LeadEstimateOutcomeRejection) {
    super(`Lead estimate outcome rejected: ${reason}.`);
  }
}

export const LEAD_ESTIMATE_OUTCOME_SOURCES = ["ADMIN_RECORDED", "CUSTOMER_REPORTED", "PROFESSIONAL_REPORTED"] as const;
export type LeadEstimateOutcomeSource = (typeof LEAD_ESTIMATE_OUTCOME_SOURCES)[number];

export const LEAD_ESTIMATE_OUTCOME_NOTE_MAX_LENGTH = 500;
/** Same Decimal(10,2) ceiling as the lead snapshot. */
const MAX_CENTS = 9_999_999_999n;

export interface LeadEstimateOutcomeRecord {
  id: string;
  leadId: string;
  actualJobValue: string;
  source: LeadEstimateOutcomeSource;
  recordedByUserId: string;
  recordedAt: Date;
  note: string | null;
}

export interface NormalizedLeadEstimateOutcome {
  actualJobValue: string;
  note: string | null;
}

/** Plain decimal, > 0, at most 2 fraction digits, within the column. Anything else is INVALID_INPUT — never coerced. */
export function normalizeLeadEstimateOutcome(input: unknown): NormalizedLeadEstimateOutcome {
  if (typeof input !== "object" || input === null) throw new LeadEstimateOutcomeRejectedError("INVALID_INPUT");
  const { actualJobValue, note } = input as Record<string, unknown>;
  const cents = parseScaledDecimal(actualJobValue, 2);
  if (cents === null || cents <= 0n || cents > MAX_CENTS) throw new LeadEstimateOutcomeRejectedError("INVALID_INPUT");
  let cleanNote: string | null = null;
  if (note !== undefined && note !== null) {
    if (typeof note !== "string" || note.length > LEAD_ESTIMATE_OUTCOME_NOTE_MAX_LENGTH || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(note)) {
      throw new LeadEstimateOutcomeRejectedError("INVALID_INPUT");
    }
    cleanNote = note.trim() === "" ? null : note.trim();
  }
  return { actualJobValue: actualJobValue as string, note: cleanNote };
}
