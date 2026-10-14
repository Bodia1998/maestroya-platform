import type { EstimateObservation } from "@/domain/services/lead-estimate-accuracy";
import type { LeadEstimateOutcomeRecord, LeadEstimateOutcomeSource } from "@/domain/services/lead-estimate-outcome";

/**
 * Module 164 — persistence port of recorded actual job values (table `lead_estimate_outcomes`). One outcome per lead, immutable.
 */
export interface LeadEstimateOutcomeRepository {
  /** Inserts, or reports the existing row for the lead (`created` false). The unique key makes concurrent attempts safe. */
  record(input: {
    leadId: string;
    actualJobValue: string;
    source: LeadEstimateOutcomeSource;
    recordedByUserId: string;
    recordedAt: Date;
    note: string | null;
  }): Promise<{ outcome: LeadEstimateOutcomeRecord; created: boolean }>;

  findByLeadId(leadId: string): Promise<LeadEstimateOutcomeRecord | null>;
}

/** Read model for the accuracy report: published estimates joined to recorded outcomes. Bounded; ids, codes and money only. */
export interface LeadEstimateObservationReader {
  listObservations(limit: number): Promise<EstimateObservation[]>;
}
