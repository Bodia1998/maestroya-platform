import type { TrustRiskEventReasonValue } from "@/domain/services/trust-score-policy";

export const TRUST_AUTOMATED_ACTION_TYPE_VALUES = [
  "WARNING",
  "TEMPORARY_RESTRICTION",
  "BOOKING_RESTRICTION",
  "MESSAGING_RESTRICTION",
  "PAYOUT_HOLD",
  "MANUAL_REVIEW",
  "TEMPORARY_SUSPENSION",
  "PERMANENT_SUSPENSION",
] as const;
export type TrustAutomatedActionTypeValue = (typeof TRUST_AUTOMATED_ACTION_TYPE_VALUES)[number];

export const TRUST_AUTOMATED_ACTION_STATUS_VALUES = ["ACTIVE", "EXPIRED", "REVERSED"] as const;
export type TrustAutomatedActionStatusValue = (typeof TRUST_AUTOMATED_ACTION_STATUS_VALUES)[number];

/**
 * Module 65 — Trust & Integrity System: repository interface for
 * `TrustAutomatedAction`, requirement #15's ledger of every
 * warning/restriction/suspension/manual-review/payout-hold applied to a
 * user. See the Prisma model's own doc comment for why this is kept
 * distinct from Module 24's `AccountRestriction`.
 */
export interface TrustAutomatedActionRecord {
  id: string;
  userId: string;
  type: TrustAutomatedActionTypeValue;
  status: TrustAutomatedActionStatusValue;
  reason: TrustRiskEventReasonValue;
  triggeringRiskScore: number;
  detail: string;
  createdByUserId: string | null;
  expiresAt: Date | null;
  reversedAt: Date | null;
  reversedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTrustAutomatedActionData {
  userId: string;
  type: TrustAutomatedActionTypeValue;
  reason: TrustRiskEventReasonValue;
  triggeringRiskScore: number;
  detail: string;
  createdByUserId?: string | null;
  expiresAt?: Date | null;
}

export interface TrustAutomatedActionRepository {
  create(data: CreateTrustAutomatedActionData): Promise<TrustAutomatedActionRecord>;
  findById(id: string): Promise<TrustAutomatedActionRecord | null>;
  listForUser(userId: string): Promise<TrustAutomatedActionRecord[]>;
  /** Every `ACTIVE` action for this user, optionally narrowed to one
   *  type — the query `decide-automated-action`'s
   *  `priorActiveActionsForUser` count and any future booking/messaging
   *  enforcement check both need. */
  listActiveForUser(userId: string, type?: TrustAutomatedActionTypeValue): Promise<TrustAutomatedActionRecord[]>;
  countActiveForUser(userId: string): Promise<number>;
  reverse(id: string, reversedByUserId: string): Promise<TrustAutomatedActionRecord>;
  /** Marks every `ACTIVE` action whose `expiresAt` has passed as
   *  `EXPIRED` — called by a scheduled sweep (out of this module's own
   *  scope to schedule; see docs/MODULE_65's own "Future Integration
   *  Readiness" section) or on-demand before a gating check. */
  expireDue(now: Date): Promise<number>;
  countAll(): Promise<number>;
  countByType(type: TrustAutomatedActionTypeValue): Promise<number>;
  /** Every row with status ACTIVE, across all users — feeds the report
   *  generator's statistics section. */
  countActive(): Promise<number>;
}
