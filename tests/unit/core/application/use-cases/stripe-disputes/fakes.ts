import type {
  MarkStripeDisputeClosedInput,
  StripeDisputeRecord,
  StripeDisputeRepository,
  UpsertStripeDisputeData,
} from "@/domain/repositories/stripe-dispute-repository";

/**
 * Module 86 — Stripe Chargeback & Dispute Handling: in-memory fake for
 * this module's own use-case tests, mirroring
 * `PrismaStripeDisputeRepository`'s exact semantics (insert-or-return-
 * existing keyed on `stripeDisputeId`, terminal-status guard on
 * `updateFromStripe`/`markClosed`) — same "one fakes.ts per module's own
 * test directory" convention every other module's own fakes.ts file
 * establishes.
 */

const TERMINAL = new Set(["WON", "LOST", "WARNING_CLOSED"]);

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

export class FakeStripeDisputeRepository implements StripeDisputeRepository {
  byId = new Map<string, StripeDisputeRecord>();
  byStripeDisputeId = new Map<string, string>();

  async findByStripeDisputeId(stripeDisputeId: string): Promise<StripeDisputeRecord | null> {
    const id = this.byStripeDisputeId.get(stripeDisputeId);
    return id ? (this.byId.get(id) ?? null) : null;
  }

  async findById(id: string): Promise<StripeDisputeRecord | null> {
    return this.byId.get(id) ?? null;
  }

  async createIfNotExists(data: UpsertStripeDisputeData): Promise<{ created: boolean; record: StripeDisputeRecord }> {
    const existing = await this.findByStripeDisputeId(data.stripeDisputeId);
    if (existing) return { created: false, record: existing };

    const now = new Date();
    const record: StripeDisputeRecord = {
      id: nextId("stripe-dispute"),
      stripeDisputeId: data.stripeDisputeId,
      stripeChargeId: data.stripeChargeId,
      stripePaymentIntentId: data.stripePaymentIntentId,
      paymentId: data.paymentId,
      jobId: data.jobId,
      amount: data.amount,
      currency: data.currency,
      reason: data.reason,
      status: data.status,
      evidenceDueBy: data.evidenceDueBy,
      financialAdjustmentId: null,
      closedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.byId.set(record.id, record);
    this.byStripeDisputeId.set(record.stripeDisputeId, record.id);
    return { created: true, record };
  }

  async updateFromStripe(
    id: string,
    data: Pick<UpsertStripeDisputeData, "amount" | "reason" | "status" | "evidenceDueBy">,
  ): Promise<StripeDisputeRecord> {
    const existing = this.byId.get(id);
    if (!existing) throw new Error(`No fake StripeDispute with id "${id}".`);
    if (TERMINAL.has(existing.status)) return existing;

    const updated: StripeDisputeRecord = { ...existing, ...data, updatedAt: new Date() };
    this.byId.set(id, updated);
    return updated;
  }

  async markClosed(input: MarkStripeDisputeClosedInput): Promise<StripeDisputeRecord> {
    const existing = this.byId.get(input.id);
    if (!existing) throw new Error(`No fake StripeDispute with id "${input.id}".`);
    if (TERMINAL.has(existing.status)) return existing;

    const updated: StripeDisputeRecord = {
      ...existing,
      status: input.status,
      financialAdjustmentId: input.financialAdjustmentId,
      closedAt: new Date(),
      updatedAt: new Date(),
    };
    this.byId.set(input.id, updated);
    return updated;
  }
}
