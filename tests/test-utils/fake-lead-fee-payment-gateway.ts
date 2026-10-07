import type {
  LeadFeePaymentGateway,
  LeadFeePaymentRequest,
  LeadFeeProviderPayment,
  LeadFeeProviderPaymentStatus,
} from "@/application/ports/lead-fee-payment-gateway";

/**
 * Module 140 test double (tests only): a deterministic in-memory `LeadFeePaymentGateway`.
 * Like a real provider it honours the idempotency key (same key -> same payment), echoes
 * the amount/currency it was given, and records every call so tests can assert on them.
 */
export class FakeLeadFeePaymentGateway implements LeadFeePaymentGateway {
  readonly created: LeadFeePaymentRequest[] = [];
  readonly canceled: string[] = [];
  readonly payments = new Map<string, LeadFeeProviderPayment>();
  private readonly byKey = new Map<string, string>();
  private seq = 0;
  failCreate: Error | null = null;
  failRetrieve: Error | null = null;
  failCancel: Error | null = null;
  /** Hook run after the provider "created" the payment, before returning (simulates concurrent changes). */
  afterCreate: (() => Promise<void>) | null = null;
  /** When set, a NEW payment gets this status. */
  newStatus: LeadFeeProviderPaymentStatus = "REQUIRES_PAYMENT_METHOD";
  /** When true, every key creates a distinct payment (simulates an expired idempotency window). */
  ignoreIdempotency = false;

  async createPayment(request: LeadFeePaymentRequest): Promise<LeadFeeProviderPayment> {
    this.created.push(request);
    if (this.failCreate) throw this.failCreate;
    let reference = this.ignoreIdempotency ? undefined : this.byKey.get(request.idempotencyKey);
    if (!reference) {
      reference = `pi_fake_${++this.seq}`;
      this.byKey.set(request.idempotencyKey, reference);
      this.payments.set(reference, {
        reference,
        clientSecret: `${reference}_secret_fake`,
        status: this.newStatus,
        amountMinorUnits: request.amountMinorUnits,
        currency: request.currency,
      });
    }
    const payment = this.payments.get(reference)!;
    if (this.afterCreate) await this.afterCreate();
    return { ...payment };
  }

  async retrievePayment(reference: string): Promise<LeadFeeProviderPayment> {
    if (this.failRetrieve) throw this.failRetrieve;
    const payment = this.payments.get(reference);
    if (!payment) throw new Error("unknown fake payment");
    return { ...payment };
  }

  async cancelPayment(reference: string): Promise<void> {
    if (this.failCancel) throw this.failCancel;
    this.canceled.push(reference);
    const payment = this.payments.get(reference);
    if (payment) this.payments.set(reference, { ...payment, status: "CANCELED" });
  }
}
