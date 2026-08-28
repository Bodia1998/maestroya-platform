import type { InvoiceRepository } from "@/domain/repositories/invoice-repository";
import { satisfiesPayoutInvoicePrerequisite } from "@/domain/services/invoice-lifecycle";

export interface InvoicePayoutEligibilityResult {
  eligible: boolean;
  reason: string | null;
  invoiceId: string | null;
  invoiceStatus: string | null;
}

/**
 * Module 79 — Invoicing & Credit Notes.
 *
 * The clean application-level integration point the module brief asks
 * for: "professional payout requires the required invoice state." This
 * is a small, standalone use case — never a rewrite of Module 76's own
 * `ExecuteProfessionalPayoutUseCase` — designed to be injected as an
 * OPTIONAL extra dependency there (see that class's own updated doc
 * comment). When wired, it is consulted immediately before the Stripe
 * transfer is created, exactly like `CheckPayoutEligibilityUseCase`
 * (Module 75) already is; when a Job has no invoice at all (a Job that
 * predates Module 79, or a business flow that legitimately never drafts
 * one), it does NOT block the payout by default — see
 * `requireInvoiceForPayout`'s own parameter doc comment for how to make
 * a missing invoice a hard failure once Module 79 is fully rolled out.
 */
export class CheckInvoiceRequiredForPayoutUseCase {
  constructor(private readonly invoices: InvoiceRepository) {}

  /**
   * @param requireInvoiceForPayout When `true`, a Job with NO invoice at
   *   all is treated as `eligible: false` (invoicing is mandatory for
   *   every payout). Defaults to `false` — a missing invoice is treated
   *   as "Module 79 was not used for this Job" rather than a block,
   *   which is the safe default for a rollout where not every historical
   *   Job has one. A Job that DOES have an invoice is always held to the
   *   ISSUED-or-later bar regardless of this flag.
   */
  async execute(jobId: string, requireInvoiceForPayout = false): Promise<InvoicePayoutEligibilityResult> {
    const invoice = await this.invoices.findByJobId(jobId);

    if (!invoice) {
      return {
        eligible: !requireInvoiceForPayout,
        reason: requireInvoiceForPayout ? "No invoice exists for this job — an ISSUED invoice is required before payout." : null,
        invoiceId: null,
        invoiceStatus: null,
      };
    }

    if (invoice.status === "CANCELLED") {
      return {
        eligible: false,
        reason: "This job's invoice was cancelled — payout cannot proceed without a valid invoice.",
        invoiceId: invoice.id,
        invoiceStatus: invoice.status,
      };
    }

    const eligible = satisfiesPayoutInvoicePrerequisite(invoice.status);
    return {
      eligible,
      reason: eligible ? null : `This job's invoice is ${invoice.status} — a payout requires it to be ISSUED (or PAID) first.`,
      invoiceId: invoice.id,
      invoiceStatus: invoice.status,
    };
  }
}
