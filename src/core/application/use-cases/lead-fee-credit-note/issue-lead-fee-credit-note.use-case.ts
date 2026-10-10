import type { LeadFeeCreditNoteRepository } from "@/domain/repositories/lead-fee-credit-note-repository";
import type { LeadFeeInvoiceRepository } from "@/domain/repositories/lead-fee-invoice-repository";
import {
  LeadFeeCreditNoteNotIssuableError,
  buildLeadFeeCreditNoteDraft,
  leadFeeCreditNoteAmountsEqual,
  normalizeLeadFeeCreditNoteReason,
  type LeadFeeCreditNoteIssuanceConfig,
  type LeadFeeCreditNoteRecord,
  type LeadFeeCreditNoteRequestedAmounts,
} from "@/domain/services/lead-fee-credit-note";

export interface IssueLeadFeeCreditNoteInput {
  /** The lead purchase whose (single) M150 invoice is to be credited. Must come from a persisted record, never from a client. */
  leadPurchaseId: string;
  /** Plain bounded free text (1..500 chars). Not legal wording. */
  reason: string;
  /** Optional. When given it must equal the invoice's own amounts: partial credits are not supported. */
  requestedAmounts?: LeadFeeCreditNoteRequestedAmounts;
}

export interface IssueLeadFeeCreditNoteResult {
  /** true only for the caller that recorded the credit note; false for an idempotent replay. */
  created: boolean;
  creditNote: LeadFeeCreditNoteRecord;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Module 151 — records the FULL credit note of ONE M150 lead-fee invoice.
 *
 * TRUSTED-INTERNAL: `leadPurchaseId` must come from a persisted record, never from the client, and this use case is
 * deliberately wired to no route, Server Action, webhook, cron job or queue (no admin console exists before M157). Its
 * result contains the recipient's tax id and address.
 *
 * Authority: the persisted M150 invoice (found through the existing invoice port by purchase id) — never the purchase
 * status, a provider event, a client value or current pricing/billing configuration. The credit note is built by the pure
 * domain function `buildLeadFeeCreditNoteDraft` (fail-closed, typed reasons) and written by
 * `LeadFeeCreditNoteRepository.issue` (one transaction: lock, existing-check, number allocation, insert).
 *
 * Idempotency: a credit note that already exists for the invoice is returned unchanged (`created: false`) BEFORE any
 * configuration check — a replay never re-evaluates today's configuration, never consumes a number, and a replay that
 * carries a different reason or amounts does not change the stored document (the stored one is returned; requested
 * amounts that differ from it are still rejected).
 *
 * Side effects: NONE outside the credit-note table and its number counter. It does not refund Stripe, revoke lead access,
 * change a lead purchase or any balance, edit the invoice or the M149 ledger, or send/generate any document.
 */
export class IssueLeadFeeCreditNoteUseCase {
  constructor(
    private readonly invoices: Pick<LeadFeeInvoiceRepository, "findByLeadPurchaseId">,
    private readonly creditNotes: LeadFeeCreditNoteRepository,
    /** Read on every issuance (never cached at import time) so a configuration change takes effect without a deploy of code. */
    private readonly readConfig: () => LeadFeeCreditNoteIssuanceConfig,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(input: IssueLeadFeeCreditNoteInput): Promise<IssueLeadFeeCreditNoteResult> {
    if (typeof input !== "object" || input === null || typeof input.leadPurchaseId !== "string" || !UUID.test(input.leadPurchaseId)) {
      throw new LeadFeeCreditNoteNotIssuableError("INPUT");
    }
    // Shape-validate the reason up front so even a replay cannot be driven with garbage.
    normalizeLeadFeeCreditNoteReason(input.reason);

    const invoice = await this.invoices.findByLeadPurchaseId(input.leadPurchaseId);
    if (!invoice) throw new LeadFeeCreditNoteNotIssuableError("INVOICE_NOT_FOUND");

    const existing = await this.creditNotes.findByInvoiceId(invoice.id);
    if (existing) {
      if (input.requestedAmounts !== undefined && !leadFeeCreditNoteAmountsEqual(existing, input.requestedAmounts)) {
        // The caller wants something other than the credit already issued: never answer with a document that does not match the request.
        throw new LeadFeeCreditNoteNotIssuableError("PARTIAL_CREDIT_NOT_SUPPORTED");
      }
      return { created: false, creditNote: existing };
    }

    const draft = buildLeadFeeCreditNoteDraft({
      invoice,
      reason: input.reason,
      requestedAmounts: input.requestedAmounts,
      config: this.readConfig(),
      issuedAt: this.now(),
    });
    return this.creditNotes.issue(draft);
  }
}
