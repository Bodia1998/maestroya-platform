import { randomUUID } from "node:crypto";

import type { LeadFeeCreditNoteRepository } from "@/domain/repositories/lead-fee-credit-note-repository";
import {
  formatLeadFeeCreditNoteNumber,
  leadFeeCreditNoteYear,
  type LeadFeeCreditNoteDraft,
  type LeadFeeCreditNoteRecord,
} from "@/domain/services/lead-fee-credit-note";

/**
 * In-memory LeadFeeCreditNoteRepository mirroring the CONTRACT of the real adapter (one credit note per invoice, number
 * allocated only for the winning caller, rollback leaves no row and no consumed number). It proves use-case logic only —
 * the real PostgreSQL behaviour (constraints, triggers, locking, transactions) is proven in
 * tests/integration-db/lead-fee-credit-note.
 */
export class FakeLeadFeeCreditNoteRepository implements LeadFeeCreditNoteRepository {
  readonly rows = new Map<string, LeadFeeCreditNoteRecord>();
  readonly counters = new Map<number, number>();
  /** Simulates a failure AFTER the number was allocated (must roll the counter back). */
  failAfterAllocation: Error | null = null;
  issueCalls = 0;

  async issue(draft: LeadFeeCreditNoteDraft): Promise<{ created: boolean; creditNote: LeadFeeCreditNoteRecord }> {
    this.issueCalls += 1;
    const existing = this.rows.get(draft.leadFeeInvoiceId);
    if (existing) return { created: false, creditNote: existing };
    const year = leadFeeCreditNoteYear(draft.issuedAt);
    const sequence = (this.counters.get(year) ?? 0) + 1;
    if (this.failAfterAllocation) throw this.failAfterAllocation; // counter not committed = rolled back
    this.counters.set(year, sequence);
    const creditNote: LeadFeeCreditNoteRecord = {
      ...draft,
      id: randomUUID(),
      creditNoteNumber: formatLeadFeeCreditNoteNumber({ year, sequence }),
      createdAt: new Date(),
    };
    this.rows.set(draft.leadFeeInvoiceId, creditNote);
    return { created: true, creditNote };
  }

  async findByInvoiceId(leadFeeInvoiceId: string) {
    return this.rows.get(leadFeeInvoiceId) ?? null;
  }

  async findByLeadPurchaseId(leadPurchaseId: string) {
    return [...this.rows.values()].find((r) => r.leadPurchaseId === leadPurchaseId) ?? null;
  }
}
