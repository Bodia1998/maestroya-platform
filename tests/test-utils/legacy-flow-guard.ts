import type { TransactionFlowReader } from "@/application/ports/transaction-flow-reader";
import { TransactionFlowGuard } from "@/application/services/flow/transaction-flow-guard";
import type { TransactionFlowVersion } from "@/domain/services/transaction-flow";

/**
 * Module 131 — the legacy-flow guard is a mandatory constructor dependency of
 * every legacy-only use case. Tests that exercise the legacy happy path
 * supply a REAL TransactionFlowGuard backed by this reader, which reports
 * every ServiceRequest as the given flow (default LEGACY_QUOTE_PAYMENT).
 * Never an "always allow" stub guard — the guard logic itself still runs.
 */
export class FixedFlowReader implements TransactionFlowReader {
  constructor(private readonly flow: TransactionFlowVersion = "LEGACY_QUOTE_PAYMENT") {}
  async findFlowVersion(): Promise<TransactionFlowVersion | null> {
    return this.flow;
  }
}

export function legacyFlowGuardForTests(flow: TransactionFlowVersion = "LEGACY_QUOTE_PAYMENT"): TransactionFlowGuard {
  return new TransactionFlowGuard(new FixedFlowReader(flow));
}
