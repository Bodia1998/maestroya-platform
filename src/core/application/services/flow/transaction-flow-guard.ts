import type { TransactionFlowReader } from "@/application/ports/transaction-flow-reader";
import { NotFoundError } from "@/domain/errors/domain-error";
import {
  LegacyFlowBoundaryError,
  isLegacyQuotePaymentFlow,
  type LegacyFinancialOperation,
} from "@/domain/services/transaction-flow";
import { logger } from "@/infrastructure/observability/logger";

/**
 * Module 121 — the single place that decides "may this legacy financial
 * operation run for this ServiceRequest?". Fails closed: an unknown flow
 * value is treated as non-legacy. Logs only ids + flow (no PII).
 */
export class TransactionFlowGuard {
  constructor(private readonly flows: TransactionFlowReader) {}

  async isLegacy(serviceRequestId: string): Promise<boolean> {
    const flow = await this.flows.findFlowVersion(serviceRequestId);
    if (flow === null) throw new NotFoundError("ServiceRequest", serviceRequestId);
    return isLegacyQuotePaymentFlow(flow);
  }

  /** Throws LegacyFlowBoundaryError unless the request is LEGACY_QUOTE_PAYMENT. */
  async assertLegacy(serviceRequestId: string, operation: LegacyFinancialOperation): Promise<void> {
    const flow = await this.flows.findFlowVersion(serviceRequestId);
    if (flow === null) throw new NotFoundError("ServiceRequest", serviceRequestId);
    if (!isLegacyQuotePaymentFlow(flow)) {
      logger.warn("legacy_flow_boundary.blocked", { operation, flowVersion: flow, serviceRequestId });
      throw new LegacyFlowBoundaryError(operation, flow);
    }
  }
}

/** For subscribers/webhooks that must not throw: true = proceed (legacy),
 *  false = skipped and logged. `guard` undefined = not wired (legacy-only
 *  historical constructions), proceeds. */
export async function shouldRunLegacyFlow(
  guard: TransactionFlowGuard | undefined,
  serviceRequestId: string,
  operation: LegacyFinancialOperation,
): Promise<boolean> {
  if (!guard) return true;
  try {
    await guard.assertLegacy(serviceRequestId, operation);
    return true;
  } catch (error) {
    if (error instanceof LegacyFlowBoundaryError) return false;
    throw error;
  }
}
