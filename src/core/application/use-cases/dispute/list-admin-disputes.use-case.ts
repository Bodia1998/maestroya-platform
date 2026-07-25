import type {
  DisputePriorityValue,
  DisputeReasonValue,
  DisputeRecord,
  DisputeRepository,
  DisputeStatusValue,
} from "@/domain/repositories/dispute-repository";

export interface ListAdminDisputesInput {
  status?: DisputeStatusValue;
  priority?: DisputePriorityValue;
  reason?: DisputeReasonValue;
  assignedAdminUserId?: string;
  search?: string;
  limit: number;
  offset: number;
}

/**
 * Module 21 — Disputes & Support: admin oversight listing — filterable by
 * status/priority/reason/assignee, searchable by case number/title. Trusts
 * the caller has already been authorized via `requireRole(ADMIN,
 * SUPER_ADMIN, SUPPORT)` at the Server Action boundary — same convention as
 * every other `ListAdmin*UseCase` in this codebase (see
 * ListAdminReviewsUseCase).
 */
export class ListAdminDisputesUseCase {
  constructor(private readonly disputes: DisputeRepository) {}

  async execute(input: ListAdminDisputesInput): Promise<DisputeRecord[]> {
    return this.disputes.listForAdmin(input);
  }
}
