import type { DisputeRecord, DisputeRepository, DisputeStatusValue } from "@/domain/repositories/dispute-repository";

export interface ListMyDisputesInput {
  status?: DisputeStatusValue;
  limit: number;
  offset: number;
}

/**
 * Module 21 — Disputes & Support: lists disputes the caller opened
 * (raisedByUserId). "Disputes opened against me" (respondent-side) is
 * intentionally a separate use case (ListDisputesAgainstMeUseCase) rather
 * than merged into this one — the two have different underlying queries
 * (raisedByUserId vs "every Job I'm the professional/company party of that
 * has a dispute") and merging them would blur the "who opened this" signal
 * the UI needs to show.
 */
export class ListMyDisputesUseCase {
  constructor(private readonly disputes: DisputeRepository) {}

  async execute(userId: string, input: ListMyDisputesInput): Promise<DisputeRecord[]> {
    return this.disputes.listRaisedByUser(userId, {
      status: input.status,
      limit: input.limit,
      offset: input.offset,
    });
  }
}
