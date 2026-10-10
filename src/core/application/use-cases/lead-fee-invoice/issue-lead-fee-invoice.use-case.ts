import type { LeadFeeInvoiceRepository } from "@/domain/repositories/lead-fee-invoice-repository";
import type { LeadFeeRevenueLedgerRepository } from "@/domain/repositories/lead-fee-revenue-ledger-repository";
import type { LeadPurchaseRepository } from "@/domain/repositories/lead-purchase-repository";
import {
  LeadFeeInvoiceNotIssuableError,
  buildLeadFeeInvoiceDraft,
  type LeadFeeInvoiceIssuanceConfig,
  type LeadFeeInvoiceRecord,
} from "@/domain/services/lead-fee-invoice";
import type { GetProfessionalBillingReadinessUseCase } from "@/application/use-cases/billing-identity/get-professional-billing-readiness.use-case";

export interface IssueLeadFeeInvoiceResult {
  /** true only for the caller that recorded the invoice; false for an idempotent replay. */
  created: boolean;
  invoice: LeadFeeInvoiceRecord;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Module 150 — records the lead-fee invoice for ONE confirmed lead purchase.
 *
 * TRUSTED-INTERNAL: `leadPurchaseId` must come from a persisted record, never from the client, and this use case
 * is deliberately wired to no route, Server Action, webhook or job (nothing issues invoices automatically; there is
 * no admin console until M157). Its result contains the recipient's tax id and address.
 *
 * Authority: the persisted M149 ledger entry (found by purchase id) — never the purchase initiation, a client
 * value, a provider event body or current pricing configuration. The invoice is built by the pure domain function
 * `buildLeadFeeInvoiceDraft` (fail-closed, typed reasons) and written by `LeadFeeInvoiceRepository.issue`
 * (one transaction: lock, identity re-check, number allocation, insert).
 *
 * Idempotency: an invoice that already exists for the entry is returned unchanged (`created: false`) BEFORE any
 * configuration or billing check — a replay never re-evaluates today's identity/approval and never consumes a
 * number. Not covered here (open decisions / later modules): PDF generation, delivery, corrections, credit
 * notes (M151), refunds (M153).
 */
export class IssueLeadFeeInvoiceUseCase {
  constructor(
    private readonly ledger: Pick<LeadFeeRevenueLedgerRepository, "findByLeadPurchaseId">,
    private readonly purchases: Pick<LeadPurchaseRepository, "findById">,
    private readonly billing: Pick<GetProfessionalBillingReadinessUseCase, "execute">,
    private readonly invoices: LeadFeeInvoiceRepository,
    /** Read on every issuance (never cached at import time) so a configuration change takes effect without a deploy of code. */
    private readonly readConfig: () => LeadFeeInvoiceIssuanceConfig,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(leadPurchaseId: string): Promise<IssueLeadFeeInvoiceResult> {
    if (typeof leadPurchaseId !== "string" || !UUID.test(leadPurchaseId)) throw new LeadFeeInvoiceNotIssuableError("INPUT");

    const ledgerEntry = await this.ledger.findByLeadPurchaseId(leadPurchaseId);
    if (!ledgerEntry) throw new LeadFeeInvoiceNotIssuableError("LEDGER_ENTRY_MISSING");

    const existing = await this.invoices.findByLedgerEntryId(ledgerEntry.id);
    if (existing) return { created: false, invoice: existing };

    const config = this.readConfig();
    const purchase = await this.purchases.findById(ledgerEntry.leadPurchaseId);
    const readiness = await this.billing.execute(ledgerEntry.professionalProfileId);

    const draft = buildLeadFeeInvoiceDraft({
      ledgerEntry,
      purchase,
      billing: readiness.billingReady ? readiness.snapshot : null,
      config,
      issuedAt: this.now(),
    });
    return this.invoices.issue(draft);
  }
}
