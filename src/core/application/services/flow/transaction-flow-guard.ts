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

/**
 * Module 131 — fail-closed construction check. Legacy-only components must be
 * handed a guard; a missing one (e.g. a JS caller, a cast, a bad composition
 * root) fails loudly at construction instead of silently running legacy money
 * flows for every request.
 */
export function requireLegacyFlowGuard(
  guard: TransactionFlowGuard | null | undefined,
  owner: string,
): asserts guard is TransactionFlowGuard {
  if (!guard) {
    throw new Error(`${owner} requires a TransactionFlowGuard (Module 131: legacy-flow isolation is mandatory and fail-closed).`);
  }
}

/** For subscribers/webhooks that must not throw: true = proceed (legacy),
 *  false = skipped and logged. A missing guard is a wiring error and throws
 *  (Module 131) — it never means "proceed". */
export async function shouldRunLegacyFlow(
  guard: TransactionFlowGuard,
  serviceRequestId: string,
  operation: LegacyFinancialOperation,
): Promise<boolean> {
  requireLegacyFlowGuard(guard, "shouldRunLegacyFlow");
  try {
    await guard.assertLegacy(serviceRequestId, operation);
    return true;
  } catch (error) {
    if (error instanceof LegacyFlowBoundaryError) return false;
    throw error;
  }
}
