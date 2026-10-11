import type {
  LeadFeePaymentGateway,
  LeadFeePaymentRequest,
  LeadFeeProviderPayment,
  LeadFeeProviderPaymentFacts,
  LeadFeeProviderPaymentStatus,
  LeadFeeProviderRefund,
  LeadFeeRefundRequest,
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
  // ---- Module 153: refund capabilities
  readonly refundRequests: LeadFeeRefundRequest[] = [];
  /** Provider-side refunds per payment reference (any origin, incl. ones a test plants as "dashboard" refunds). */
  readonly refundsByPayment = new Map<string, LeadFeeProviderRefund[]>();
  /** Per-payment overrides of the refund-relevant facts (defaults derive from the created payment). */
  readonly factOverrides = new Map<string, Partial<LeadFeeProviderPaymentFacts>>();
  failFacts: Error | null = null;
  failList: Error | null = null;
  /** createRefund: throw BEFORE recording a provider refund (provider rejected the request). */
  failRefundBeforeProvider: Error | null = null;
  /** createRefund: the provider created the refund but the answer is lost (timeout): throws AFTER recording it. */
  failRefundAfterProvider: Error | null = null;
  /** Status given to a newly created refund. */
  newRefundStatus: LeadFeeProviderRefund["status"] = "SUCCEEDED";
  private readonly refundByKey = new Map<string, LeadFeeProviderRefund>();
  private refundSeq = 0;

  /** Plants a payment that "exists at the provider" (e.g. an extra duplicate charge) for the given purchase. */
  plantPayment(reference: string, request: { leadPurchaseId: string | null; amountMinorUnits: number; currency?: string; status?: LeadFeeProviderPaymentStatus }): void {
    this.payments.set(reference, {
      reference,
      clientSecret: null,
      status: request.status ?? "SUCCEEDED",
      amountMinorUnits: request.amountMinorUnits,
      currency: request.currency ?? "EUR",
    });
    this.factOverrides.set(reference, { purchaseId: request.leadPurchaseId });
  }

  async retrievePaymentFacts(reference: string): Promise<LeadFeeProviderPaymentFacts> {
    if (this.failFacts) throw this.failFacts;
    const payment = this.payments.get(reference);
    if (!payment) throw new Error("unknown fake payment");
    const created = this.created.find((c) => this.byKey.get(c.idempotencyKey) === reference);
    const refunded = (this.refundsByPayment.get(reference) ?? []).filter((r) => r.status === "SUCCEEDED" || r.status === "PENDING");
    const refundedMinor = refunded.reduce((sum, r) => sum + r.amountMinorUnits, 0);
    return {
      reference,
      status: payment.status,
      amountMinorUnits: payment.amountMinorUnits,
      amountReceivedMinorUnits: payment.status === "SUCCEEDED" ? payment.amountMinorUnits : 0,
      amountRefundedMinorUnits: refundedMinor,
      refunded: refundedMinor > 0 && refundedMinor >= payment.amountMinorUnits,
      disputed: false,
      currency: payment.currency,
      purchaseId: created?.leadPurchaseId ?? null,
      ...(this.factOverrides.get(reference) ?? {}),
    };
  }

  async listRefunds(paymentReference: string): Promise<LeadFeeProviderRefund[]> {
    if (this.failList) throw this.failList;
    return (this.refundsByPayment.get(paymentReference) ?? []).map((r) => ({ ...r }));
  }

  async createRefund(request: LeadFeeRefundRequest): Promise<LeadFeeProviderRefund> {
    this.refundRequests.push(request);
    if (this.failRefundBeforeProvider) throw this.failRefundBeforeProvider;
    let refund = this.refundByKey.get(request.idempotencyKey);
    if (!refund) {
      refund = {
        reference: `re_fake_${++this.refundSeq}`,
        paymentReference: request.paymentReference,
        status: this.newRefundStatus,
        amountMinorUnits: request.amountMinorUnits,
        currency: request.currency,
        refundRecordId: request.refundRecordId,
      };
      this.refundByKey.set(request.idempotencyKey, refund);
      this.refundsByPayment.set(request.paymentReference, [...(this.refundsByPayment.get(request.paymentReference) ?? []), refund]);
    }
    if (this.failRefundAfterProvider) throw this.failRefundAfterProvider;
    return { ...refund };
  }

  /** Test hook: change the provider-side status of a refund (e.g. PENDING -> SUCCEEDED). */
  setRefundStatus(reference: string, status: LeadFeeProviderRefund["status"]): void {
    for (const list of this.refundsByPayment.values()) for (const r of list) if (r.reference === reference) r.status = status;
  }

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
