import type { JobValueEstimationContext } from "@/domain/services/job-value-estimation";

/**
 * Module 129 — read port that supplies the minimum, estimation-only context
 * for a Lead's ServiceRequest. The context type carries no customer budget,
 * customer id, contact, street address, coordinates or free text, so an
 * adapter cannot leak them through this port.
 *
 * `null` = the Lead does not exist.
 */
export interface JobValueEstimationContextReader {
  findByLeadId(leadId: string): Promise<JobValueEstimationContext | null>;
}
