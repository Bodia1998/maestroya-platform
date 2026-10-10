import { randomUUID } from "node:crypto";

import type { LeadFeeInvoiceRepository } from "@/domain/repositories/lead-fee-invoice-repository";
import {
  LeadFeeInvoiceNotIssuableError,
  formatLeadFeeInvoiceNumber,
  leadFeeInvoiceYear,
  type LeadFeeInvoiceDraft,
  type LeadFeeInvoiceRecord,
} from "@/domain/services/lead-fee-invoice";

/**
 * In-memory LeadFeeInvoiceRepository mirroring the CONTRACT of the real adapter (one invoice per ledger entry,
 * number allocated only for the winning caller, rollback leaves no row and no consumed number, identity must
 * still be at the snapshotted revision). It proves use-case logic only — the real PostgreSQL behaviour
 * (constraints, triggers, locking, transactions) is proven in tests/integration-db/lead-fee-invoice.
 */
export class FakeLeadFeeInvoiceRepository implements LeadFeeInvoiceRepository {
  readonly rows = new Map<string, LeadFeeInvoiceRecord>();
  readonly counters = new Map<number, number>();
  /** Simulates a failure AFTER the number was allocated (must roll the counter back). */
  failAfterAllocation: Error | null = null;
  /** Revision the recipient identity currently has (null = skip the check). */
  currentIdentityRevision: number | null = null;
  issueCalls = 0;

  async issue(draft: LeadFeeInvoiceDraft): Promise<{ created: boolean; invoice: LeadFeeInvoiceRecord }> {
    this.issueCalls += 1;
    const existing = this.rows.get(draft.ledgerEntryId);
    if (existing) return { created: false, invoice: existing };
    if (this.currentIdentityRevision !== null && this.currentIdentityRevision !== draft.billingIdentityRevision) {
      throw new LeadFeeInvoiceNotIssuableError("BILLING_IDENTITY_CHANGED");
    }
    const year = leadFeeInvoiceYear(draft.issuedAt);
    const sequence = (this.counters.get(year) ?? 0) + 1;
    if (this.failAfterAllocation) throw this.failAfterAllocation; // counter not committed = rolled back
    this.counters.set(year, sequence);
    const invoice: LeadFeeInvoiceRecord = {
      ...draft,
      id: randomUUID(),
      invoiceNumber: formatLeadFeeInvoiceNumber({ year, sequence }),
      createdAt: new Date(),
    };
    this.rows.set(draft.ledgerEntryId, invoice);
    return { created: true, invoice };
  }

  async findByLedgerEntryId(ledgerEntryId: string) {
    return this.rows.get(ledgerEntryId) ?? null;
  }

  async findByLeadPurchaseId(leadPurchaseId: string) {
    return [...this.rows.values()].find((r) => r.leadPurchaseId === leadPurchaseId) ?? null;
  }
}
