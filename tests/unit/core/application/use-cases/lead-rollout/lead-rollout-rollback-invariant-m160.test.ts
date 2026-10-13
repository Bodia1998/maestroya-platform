import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Same inert stand-ins as the M159 wiring test: a REFUSED call never reaches a collaborator, and a call that is let through fails
// (or returns) inside the wrapped use case against these stubs - which is exactly the pass-through this file needs to observe.
vi.mock("@/infrastructure/database/prisma/client", () => ({ prisma: {} }));
vi.mock("@/infrastructure/payments/stripe/client", () => ({ stripe: {} }));
vi.mock("@/infrastructure/observability/logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { LeadRolloutGuarded } from "@/application/use-cases/lead-rollout/lead-rollout-guard";
import { makeInitiateLeadFeePaymentUseCase, makeProcessLeadFeePaymentWebhookUseCase } from "@/application/use-cases/lead-fee-payment/compose";
import { makeLeadFeeDisputeReconciler, makeProcessLeadFeeDisputeWebhookUseCase, makeRevokeLeadPurchaseUseCase, makeSubmitLeadFeeDisputeEvidenceUseCase } from "@/application/use-cases/lead-fee-dispute/compose";
import { makeExecuteLeadFeeRefundUseCase } from "@/application/use-cases/lead-fee-refund/compose";
import { makeIssueLeadFeeCreditNoteUseCase } from "@/application/use-cases/lead-fee-credit-note/compose";
import { makeIssueLeadFeeInvoiceUseCase } from "@/application/use-cases/lead-fee-invoice/compose";
import { makeReconcileLeadFeeDocumentsUseCase } from "@/application/use-cases/lead-fee-document-reconciliation/compose";
import { makeDecideLeadQualityClaimUseCase, makeStartLeadQualityClaimReviewUseCase, makeSubmitLeadQualityClaimUseCase } from "@/application/use-cases/lead-quality-claim/compose";
import { makeRecordLeadContactSharingUseCase, makeRunLeadPrivacyRetentionUseCase, makeWithdrawLeadContactSharingUseCase } from "@/application/use-cases/lead-privacy/compose";
import { makeConfirmLeadPurchaseUseCase, makeTransitionLeadPurchaseUseCase } from "@/application/use-cases/lead-purchase/compose";
import { makeGetLeadContactUseCase } from "@/application/use-cases/lead-contact/compose";
import { makeGetLeadPurchaseCheckoutUseCase } from "@/application/use-cases/lead-checkout/compose";
import { makeGetPublishedLeadPreviewUseCase } from "@/application/use-cases/lead/compose";
import { LEAD_ROLLOUT_MODES, LeadV1RolloutDisabledError } from "@/domain/services/lead-rollout";

/**
 * Module 160 - the critical rollback invariant, tested against the REAL composition-root wiring (not documentation):
 * turning new LEAD_V1 acquisition off - in any mode, with a missing or malformed value - must never disable the paths that finish
 * or protect existing business.
 */
const U = "11111111-1111-4111-8111-111111111111";
const L = "22222222-2222-4222-8222-222222222222";

type Executable = { execute: (...args: never[]) => Promise<unknown> };
const PROTECTED: Array<{ name: string; make: () => unknown; args: unknown[] }> = [
  { name: "lead-fee payment webhook confirmation (M141)", make: makeProcessLeadFeePaymentWebhookUseCase, args: [{ id: "evt_x", type: "payment_intent.succeeded" }] },
  { name: "lead-fee dispute webhook (M155)", make: makeProcessLeadFeeDisputeWebhookUseCase, args: [{ id: "evt_x", type: "charge.dispute.created" }] },
  { name: "lead-fee dispute evidence submission (M155)", make: makeSubmitLeadFeeDisputeEvidenceUseCase, args: [{}] },
  { name: "contact-access revocation (M155)", make: makeRevokeLeadPurchaseUseCase, args: [{}] },
  { name: "lead-fee dispute reconciler (M155)", make: makeLeadFeeDisputeReconciler, args: [] },
  { name: "lead-fee refund execution (M153)", make: makeExecuteLeadFeeRefundUseCase, args: [{}] },
  { name: "credit note issuance (M151)", make: makeIssueLeadFeeCreditNoteUseCase, args: [{}] },
  { name: "lead-fee invoice issuance (M150)", make: makeIssueLeadFeeInvoiceUseCase, args: [{}] },
  { name: "document reconciliation (M152)", make: makeReconcileLeadFeeDocumentsUseCase, args: [{}] },
  { name: "quality claim submit (M154)", make: makeSubmitLeadQualityClaimUseCase, args: [U, {}] },
  { name: "quality claim review start (M154)", make: makeStartLeadQualityClaimReviewUseCase, args: [U, L] },
  { name: "quality claim decision (M154)", make: makeDecideLeadQualityClaimUseCase, args: [{}] },
  { name: "consent record (M158)", make: makeRecordLeadContactSharingUseCase, args: [U, L] },
  { name: "consent withdrawal (M158)", make: makeWithdrawLeadContactSharingUseCase, args: [U, L] },
  { name: "retention job (M158)", make: makeRunLeadPrivacyRetentionUseCase, args: [{ batchSize: 1, dryRun: true }] },
  { name: "purchase confirmation lifecycle (M137)", make: makeConfirmLeadPurchaseUseCase, args: [L] },
  { name: "purchase transition lifecycle (M137)", make: makeTransitionLeadPurchaseUseCase, args: [L] },
  { name: "contact access of a confirmed buyer (M138)", make: makeGetLeadContactUseCase, args: [U, L] },
  { name: "own-purchase checkout state", make: makeGetLeadPurchaseCheckoutUseCase, args: [U, L] },
  { name: "single-lead preview", make: makeGetPublishedLeadPreviewUseCase, args: [U, L] },
];

async function refusedByRollout(make: () => unknown, args: unknown[]): Promise<boolean> {
  try {
    const useCase = make() as Executable & { reconcile?: (...a: unknown[]) => Promise<unknown> };
    const run = typeof useCase.execute === "function" ? useCase.execute : useCase.reconcile;
    if (typeof run !== "function") return false;
    await (run as (...a: unknown[]) => Promise<unknown>).apply(useCase, args);
  } catch (error) {
    return error instanceof LeadV1RolloutDisabledError;
  }
  return false;
}

const original = process.env.LEAD_V1_ROLLOUT_MODE;
beforeEach(() => {
  delete process.env.LEAD_V1_ROLLOUT_MODE;
});
afterEach(() => {
  if (original === undefined) delete process.env.LEAD_V1_ROLLOUT_MODE;
  else process.env.LEAD_V1_ROLLOUT_MODE = original;
});

describe("M160 - rollback invariant on the real composition roots", () => {
  it.each(PROTECTED)("$name is not wrapped by a rollout guard", ({ make }) => {
    expect(make()).not.toBeInstanceOf(LeadRolloutGuarded);
  });

  const SETTINGS: Array<string | undefined> = [undefined, "", ...LEAD_ROLLOUT_MODES, "enabled", "true", " ENABLED", "garbage"];
  for (const setting of SETTINGS) {
    it(`with LEAD_V1_ROLLOUT_MODE=${JSON.stringify(setting)} no protected path is ever refused by the rollout switch`, async () => {
      if (setting === undefined) delete process.env.LEAD_V1_ROLLOUT_MODE;
      else process.env.LEAD_V1_ROLLOUT_MODE = setting;
      for (const entry of PROTECTED) {
        expect(await refusedByRollout(entry.make, entry.args), `${entry.name} under ${JSON.stringify(setting)}`).toBe(false);
      }
    });
  }

  it("positive control: the same probe DOES detect a refusal on a guarded entry point (the assertions above are not vacuous)", async () => {
    process.env.LEAD_V1_ROLLOUT_MODE = "DISABLED";
    expect(await refusedByRollout(makeInitiateLeadFeePaymentUseCase, [U, L])).toBe(true);
  });
});
