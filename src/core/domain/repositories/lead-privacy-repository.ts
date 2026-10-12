import type { LeadContactSharingBasis } from "@/domain/services/lead-privacy";

/**
 * Module 158 — persistence ports for LEAD_V1 privacy.
 *
 * SECURITY: nothing here returns customer contact data (no name / email / phone / address / request text). Records carry ids, a
 * basis, a notice version and timestamps; reports carry counts only.
 */

export interface LeadContactSharingRecordData {
  id: string;
  leadId: string;
  /** The customer's User id (pseudonymous after erasure: the User row is anonymized, not deleted). */
  userId: string;
  basis: LeadContactSharingBasis;
  noticeVersion: string;
  recordedAt: Date;
  withdrawnAt: Date | null;
}

export interface RecordLeadContactSharingData {
  leadId: string;
  userId: string;
  basis: LeadContactSharingBasis;
  noticeVersion: string;
  recordedAt: Date;
}

export interface LeadContactSharingRepository {
  /**
   * Idempotent: at most ONE record per lead (database UNIQUE). Returns the existing record unchanged (`created = false`) when one
   * already exists — a repeated or concurrent call never rewrites the evidence nor turns a withdrawn consent back into a granted one.
   */
  record(data: RecordLeadContactSharingData): Promise<{ record: LeadContactSharingRecordData; created: boolean }>;
  findByLeadId(leadId: string): Promise<LeadContactSharingRecordData | null>;
  /**
   * Idempotent, status-conditional: stamps `withdrawnAt` once, only on a CONSENT record that is not yet withdrawn.
   * `changed = false` for a repeat; the record is returned either way (`null` when none exists).
   */
  withdraw(leadId: string, withdrawnAt: Date): Promise<{ record: LeadContactSharingRecordData | null; changed: boolean }>;
  /** The data subject's own records, for the personal-data export (bounded). */
  listByUser(userId: string, limit: number): Promise<LeadContactSharingRecordData[]>;
}

export interface LeadPrivacySweepOptions {
  /** Hard upper bound of rows examined / changed in this call. */
  limit: number;
  /** Report what WOULD change; write nothing. */
  dryRun: boolean;
}

export interface LeadRequestAnonymizationResult {
  /** Rows that qualified (and, unless dryRun, were claimed) in this call. */
  eligible: number;
  /** Rows actually rewritten (0 when dryRun). */
  anonymized: number;
  /** LEAD_V1 leads taken off the market by the request cancellation that accompanies erasure. */
  leadsCancelled: number;
}

export interface LeadPrivacyRetentionRepository {
  /**
   * Erasure follow-through: for LEAD_V1 service requests of customers whose account personal data was already erased
   * (`users.personalDataErasedAt IS NOT NULL`), overwrite the free text (title / description) with a fixed placeholder, mark the
   * request deleted, cancel it (which, through the existing central propagation, also cancels its lead) and drop its photo rows.
   * Optionally scoped to one user. Idempotent (an already anonymized request no longer qualifies) and safe under concurrency
   * (rows are claimed with `FOR UPDATE SKIP LOCKED`; the update repeats the qualifying predicate).
   *
   * Never touches a purchase, ledger entry, invoice, credit note, claim, dispute, revocation, abuse record or audit entry.
   */
  anonymizeRequestsOfErasedCustomers(options: LeadPrivacySweepOptions & { userId?: string }): Promise<LeadRequestAnonymizationResult>;

  /**
   * Period-based minimization: free text of requests whose lead has been TERMINAL (CLOSED / EXPIRED / CANCELLED) since `cutoff` or
   * earlier and that has NO purchase in PENDING_PAYMENT / CONFIRMED / DISPUTED (see PURCHASE_STATUSES_BLOCKING_MINIMIZATION). Only the title / description are
   * overwritten; the request, lead, purchases and every financial record stay. `cutoff = null` (no approved period) does nothing.
   */
  minimizeTerminalLeadRequestContent(options: LeadPrivacySweepOptions & { cutoff: Date | null }): Promise<LeadRequestAnonymizationResult>;

  /** Counts only (no ids, no data): published / draft LEAD_V1 leads that have no contact-sharing record. A rollout report. */
  countOpenLeadsWithoutContactSharingRecord(): Promise<number>;
}
