import type { ProviderFinancialReconciliationPort } from "@/application/ports/provider-financial-reconciliation";
import type { ProviderState } from "@/domain/services/reconciliation/provider-checks";

/**
 * Module 80 — Financial Reconciliation & Observability.
 *
 * Default `ProviderFinancialReconciliationPort` binding
 * (`infrastructure/reconciliation/compose.ts`) until an operator
 * explicitly opts into live Stripe reconciliation. Unlike
 * `NullPaymentGateway` (which throws — a payment operation reaching an
 * unconfigured gateway is a wiring bug that must fail loudly), every
 * method here returns `null` rather than throwing: "the provider's state
 * could not be verified this run" is itself a valid, expected, and
 * already-modeled outcome (`checkProviderConsistency` reports it as
 * `PROVIDER_STATE_UNKNOWN`, a WARNING, distinct from a genuine
 * `PROVIDER_LOCAL_STATE_MISMATCH`). A reconciliation run must never crash
 * — and must never fabricate a false "matches" verdict — just because
 * provider verification isn't wired up in a given environment.
 *
 * See `MODULE_80_IMPLEMENTATION_REPORT.md`, "Remaining risks and
 * limitations," for why `StripeProviderReconciliationAdapter`
 * (the real implementation) has not been exercised against live Stripe
 * credentials in this environment, and what a production rollout still
 * requires before switching the composition root over to it.
 */
export class NullProviderReconciliationAdapter implements ProviderFinancialReconciliationPort {
  async retrievePaymentState(): Promise<ProviderState | null> {
    return null;
  }
  async retrieveTransferState(): Promise<ProviderState | null> {
    return null;
  }
  async retrieveRefundState(): Promise<ProviderState | null> {
    return null;
  }
}
