import type { AppealStateValue } from "@/domain/entities/appeal";

/**
 * Module 65 — Trust & Integrity System: repository interface for
 * `TrustAppeal`, requirement #17's appeal workflow.
 */
export interface TrustAppealRecord {
  id: string;
  userId: string;
  automatedActionId: string;
  state: AppealStateValue;
  userStatement: string;
  reviewedAt: Date | null;
  reviewedByUserId: string | null;
  reviewNotes: string | null;
  restoredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTrustAppealData {
  userId: string;
  automatedActionId: string;
  userStatement: string;
}

export interface TrustAppealRepository {
  create(data: CreateTrustAppealData): Promise<TrustAppealRecord>;
  findById(id: string): Promise<TrustAppealRecord | null>;
  listForUser(userId: string): Promise<TrustAppealRecord[]>;
  /** Non-terminal appeals against `automatedActionId` — used by
   *  `SubmitAppealUseCase` to enforce `DuplicateAppealError`. */
  findOpenByAutomatedActionId(automatedActionId: string): Promise<TrustAppealRecord | null>;
  listByState(state: AppealStateValue): Promise<TrustAppealRecord[]>;
  transition(
    id: string,
    state: AppealStateValue,
    data?: { reviewedByUserId?: string; reviewNotes?: string; restoredAt?: Date },
  ): Promise<TrustAppealRecord>;
  countByState(state: AppealStateValue): Promise<number>;
  countAll(): Promise<number>;
}
