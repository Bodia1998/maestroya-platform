import type { TransactionFlowVersion } from "@/domain/services/transaction-flow";

/** Module 121 — narrow read port for `ServiceRequest.flowVersion`. Kept
 *  separate from ServiceRequestRepository so the boundary needs no change
 *  to that (widely faked) interface. */
export interface TransactionFlowReader {
  /** `null` when the ServiceRequest does not exist. */
  findFlowVersion(serviceRequestId: string): Promise<TransactionFlowVersion | null>;
}
