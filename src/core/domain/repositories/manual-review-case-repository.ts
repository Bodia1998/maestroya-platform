import type { ManualReviewCaseStateValue } from "@/domain/entities/manual-review-case";
import type { TrustRiskEventReasonValue } from "@/domain/services/trust-score-policy";

/**
 * Module 65 — Trust & Integrity System: repository interface for
 * `ManualReviewCase`, requirement #16's investigation queue.
 */
export interface ManualReviewCaseRecord {
  id: string;
  userId: string;
  state: ManualReviewCaseStateValue;
  reason: TrustRiskEventReasonValue;
  summary: string;
  assignedAdminId: string | null;
  resolvedAt: Date | null;
  resolvedByUserId: string | null;
  resolutionNotes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateManualReviewCaseData {
  userId: string;
  reason: TrustRiskEventReasonValue;
  summary: string;
}

export interface ManualReviewCaseRepository {
  create(data: CreateManualReviewCaseData): Promise<ManualReviewCaseRecord>;
  findById(id: string): Promise<ManualReviewCaseRecord | null>;
  listForUser(userId: string): Promise<ManualReviewCaseRecord[]>;
  listByState(state: ManualReviewCaseStateValue): Promise<ManualReviewCaseRecord[]>;
  assign(id: string, adminId: string): Promise<ManualReviewCaseRecord>;
  transition(
    id: string,
    state: ManualReviewCaseStateValue,
    data?: { resolvedByUserId?: string; resolutionNotes?: string },
  ): Promise<ManualReviewCaseRecord>;
  countByState(state: ManualReviewCaseStateValue): Promise<number>;
  countAll(): Promise<number>;
}
