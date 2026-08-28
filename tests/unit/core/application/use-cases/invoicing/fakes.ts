import type { JobRecord, JobRepository } from "@/domain/repositories/job-repository";
import type { PaymentRecord, PaymentRepository } from "@/domain/repositories/payment-repository";
import type { QuoteRecord, QuoteRepository } from "@/domain/repositories/quote-repository";
import type { ProfessionalRecord, ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { CompanyRecord, CompanyRepository } from "@/domain/repositories/company-repository";
import type {
  GrantSelfBillingAuthorizationData,
  SelfBillingAuthorizationRecord,
  SelfBillingAuthorizationRepository,
} from "@/domain/repositories/self-billing-authorization-repository";
import type {
  AcceptInvoiceData,
  CancelInvoiceData,
  CreateInvoiceDraftData,
  InvoiceNumberAllocator,
  InvoiceRecord,
  InvoiceRepository,
  InvoiceStatusValue,
  IssueInvoiceData,
  UpdateInvoiceResult,
} from "@/domain/repositories/invoice-repository";
import type {
  CreateCreditNoteData,
  CreditNoteRecord,
  CreditNoteRepository,
  IssueCreditNoteData,
} from "@/domain/repositories/credit-note-repository";
import type { CommissionRateRepository } from "@/domain/repositories/commission-rate-repository";
import { DEFAULT_COMMISSION_RATES } from "@/domain/services/commission-policy";
import type { DomainEvent, DomainEventClass } from "@/domain/events/domain-event";
import type { EventBus, EventHandler } from "@/application/ports/event-bus";

/**
 * Module 79 — Invoicing & Credit Notes: in-memory fakes for this module's
 * own use-case tests — same "one fakes set per module's own test
 * directory" convention `tests/unit/core/application/use-cases/payments/fakes.ts`
 * already establishes.
 */

export class FakeJobRepository implements Pick<JobRepository, "findById"> {
  byId = new Map<string, JobRecord>();
  seed(record: JobRecord): void {
    this.byId.set(record.id, record);
  }
  async findById(id: string): Promise<JobRecord | null> {
    return this.byId.get(id) ?? null;
  }
}

export class FakePaymentRepository implements Pick<PaymentRepository, "findByJobId"> {
  byJobId = new Map<string, PaymentRecord[]>();
  seed(jobId: string, records: PaymentRecord[]): void {
    this.byJobId.set(jobId, records);
  }
  async findByJobId(jobId: string): Promise<PaymentRecord[]> {
    return this.byJobId.get(jobId) ?? [];
  }
}

export class FakeQuoteRepository implements Pick<QuoteRepository, "findById"> {
  byId = new Map<string, QuoteRecord>();
  seed(record: QuoteRecord): void {
    this.byId.set(record.id, record);
  }
  async findById(id: string): Promise<QuoteRecord | null> {
    return this.byId.get(id) ?? null;
  }
}

export class FakeProfessionalRepository implements Pick<ProfessionalRepository, "findById"> {
  byId = new Map<string, ProfessionalRecord>();
  seed(record: ProfessionalRecord): void {
    this.byId.set(record.id, record);
  }
  async findById(id: string): Promise<ProfessionalRecord | null> {
    return this.byId.get(id) ?? null;
  }
}

export class FakeCompanyRepository implements Pick<CompanyRepository, "findById"> {
  byId = new Map<string, CompanyRecord>();
  seed(record: CompanyRecord): void {
    this.byId.set(record.id, record);
  }
  async findById(id: string): Promise<CompanyRecord | null> {
    return this.byId.get(id) ?? null;
  }
}

export class FakeCommissionRateRepository implements CommissionRateRepository {
  rates = DEFAULT_COMMISSION_RATES;
  async getCurrentRates() {
    return this.rates;
  }
}

let sbaIdCounter = 0;

export class FakeSelfBillingAuthorizationRepository implements SelfBillingAuthorizationRepository {
  rows: SelfBillingAuthorizationRecord[] = [];

  async findActiveForProfessional(professionalProfileId: string): Promise<SelfBillingAuthorizationRecord | null> {
    return this.rows.find((r) => r.professionalProfileId === professionalProfileId && r.status === "ACTIVE") ?? null;
  }

  async findActiveForCompany(companyProfileId: string): Promise<SelfBillingAuthorizationRecord | null> {
    return this.rows.find((r) => r.companyProfileId === companyProfileId && r.status === "ACTIVE") ?? null;
  }

  async grant(data: GrantSelfBillingAuthorizationData): Promise<SelfBillingAuthorizationRecord> {
    const existing = data.professionalProfileId
      ? await this.findActiveForProfessional(data.professionalProfileId)
      : data.companyProfileId
        ? await this.findActiveForCompany(data.companyProfileId)
        : null;
    if (existing && existing.agreementVersion === data.agreementVersion) return existing;
    if (existing) {
      existing.status = "REVOKED";
      existing.revokedAt = new Date();
      existing.revokedByUserId = data.acceptedByUserId;
    }
    const record: SelfBillingAuthorizationRecord = {
      id: `sba-${++sbaIdCounter}`,
      professionalProfileId: data.professionalProfileId ?? null,
      companyProfileId: data.companyProfileId ?? null,
      status: "ACTIVE",
      agreementVersion: data.agreementVersion,
      acceptedByUserId: data.acceptedByUserId,
      acceptedAt: data.acceptedAt,
      acceptanceIpAddress: data.acceptanceIpAddress ?? null,
      acceptanceUserAgent: data.acceptanceUserAgent ?? null,
      revokedAt: null,
      revokedByUserId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.rows.push(record);
    return record;
  }

  async revoke(id: string, revokedByUserId: string, revokedAt: Date): Promise<SelfBillingAuthorizationRecord> {
    const row = this.rows.find((r) => r.id === id);
    if (!row) throw new Error(`SelfBillingAuthorization ${id} not found.`);
    if (row.status === "REVOKED") return row;
    row.status = "REVOKED";
    row.revokedAt = revokedAt;
    row.revokedByUserId = revokedByUserId;
    return row;
  }
}

let invoiceIdCounter = 0;

export class FakeInvoiceRepository implements InvoiceRepository {
  rows: InvoiceRecord[] = [];

  async findById(id: string): Promise<InvoiceRecord | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }

  async findByJobId(jobId: string): Promise<InvoiceRecord | null> {
    return this.rows.filter((r) => r.jobId === jobId && r.status !== "CANCELLED").sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
  }

  async findByInvoiceNumber(invoiceNumber: string): Promise<InvoiceRecord | null> {
    return this.rows.find((r) => r.invoiceNumber === invoiceNumber) ?? null;
  }

  async listForProfessional(professionalProfileId: string): Promise<InvoiceRecord[]> {
    return this.rows.filter((r) => r.professionalProfileId === professionalProfileId);
  }

  async createDraft(data: CreateInvoiceDraftData): Promise<InvoiceRecord> {
    const now = new Date();
    const record: InvoiceRecord = {
      id: `invoice-${++invoiceIdCounter}`,
      invoiceNumber: null,
      type: "PROFESSIONAL_SELF_BILLED",
      status: "DRAFT",
      jobId: data.jobId,
      quoteId: data.quoteId,
      paymentId: data.paymentId,
      professionalProfileId: data.professionalProfileId,
      companyProfileId: data.companyProfileId,
      customerId: data.customerId,
      issuerLegalName: data.issuerLegalName,
      issuerTaxId: data.issuerTaxId,
      recipientLegalName: data.recipientLegalName,
      recipientTaxId: data.recipientTaxId,
      selfBilled: true,
      selfBillingAuthorizationId: data.selfBillingAuthorizationId,
      issueDate: null,
      invoiceDate: data.invoiceDate,
      acceptedAt: null,
      acceptedByUserId: null,
      acceptanceAgreementVersion: null,
      currency: data.currency,
      lineItems: data.lineItems.map((item, i) => ({ id: `line-${invoiceIdCounter}-${i}`, sortOrder: i, ...item })),
      taxableBase: data.taxableBase,
      vatRateBps: data.vatRateBps,
      vatAmount: data.vatAmount,
      commissionBase: data.commissionBase,
      commissionRateBps: data.commissionRateBps,
      commissionAmount: data.commissionAmount,
      irpfWithholdingRateBps: data.irpfWithholdingRateBps,
      irpfWithholdingAmount: data.irpfWithholdingAmount,
      totalAmount: data.totalAmount,
      documentHash: null,
      version: 1,
      cancelledAt: null,
      cancelledByUserId: null,
      cancellationReason: null,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.push(record);
    return record;
  }

  private applyIfStatusMatches(id: string, fromStatuses: readonly InvoiceStatusValue[], mutate: (record: InvoiceRecord) => void): UpdateInvoiceResult {
    const record = this.rows.find((r) => r.id === id);
    if (!record) throw new Error(`Invoice ${id} not found.`);
    if (!fromStatuses.includes(record.status)) {
      return { applied: false, record };
    }
    mutate(record);
    record.updatedAt = new Date();
    return { applied: true, record };
  }

  async submitForAcceptance(id: string, fromStatuses: readonly InvoiceStatusValue[]): Promise<UpdateInvoiceResult> {
    return this.applyIfStatusMatches(id, fromStatuses, (r) => {
      r.status = "PENDING_ACCEPTANCE";
    });
  }

  async accept(data: AcceptInvoiceData): Promise<UpdateInvoiceResult> {
    return this.applyIfStatusMatches(data.id, data.fromStatuses, (r) => {
      r.status = "ACCEPTED";
      r.acceptedAt = data.acceptedAt;
      r.acceptedByUserId = data.acceptedByUserId;
      r.acceptanceAgreementVersion = data.acceptanceAgreementVersion;
    });
  }

  async issue(data: IssueInvoiceData): Promise<UpdateInvoiceResult> {
    return this.applyIfStatusMatches(data.id, data.fromStatuses, (r) => {
      r.status = "ISSUED";
      r.invoiceNumber = data.invoiceNumber;
      r.issueDate = data.issueDate;
      r.documentHash = data.documentHash;
    });
  }

  async markPaid(id: string, _paidAt: Date, fromStatuses: readonly InvoiceStatusValue[]): Promise<UpdateInvoiceResult> {
    return this.applyIfStatusMatches(id, fromStatuses, (r) => {
      r.status = "PAID";
    });
  }

  async cancel(data: CancelInvoiceData): Promise<UpdateInvoiceResult> {
    return this.applyIfStatusMatches(data.id, data.fromStatuses, (r) => {
      r.status = "CANCELLED";
      r.cancelledAt = data.cancelledAt;
      r.cancelledByUserId = data.cancelledByUserId;
      r.cancellationReason = data.reason;
    });
  }
}

let creditNoteIdCounter = 0;

export class FakeCreditNoteRepository implements CreditNoteRepository {
  rows: CreditNoteRecord[] = [];

  async findById(id: string): Promise<CreditNoteRecord | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<CreditNoteRecord | null> {
    return this.rows.find((r) => r.idempotencyKey === idempotencyKey) ?? null;
  }

  async listByOriginalInvoiceId(originalInvoiceId: string): Promise<CreditNoteRecord[]> {
    return this.rows.filter((r) => r.originalInvoiceId === originalInvoiceId);
  }

  async sumCreditedAmountForInvoice(originalInvoiceId: string): Promise<number> {
    return this.rows
      .filter((r) => r.originalInvoiceId === originalInvoiceId && r.status !== "CANCELLED")
      .reduce((sum, r) => sum + r.totalAmount, 0);
  }

  async createOrGetExisting(data: CreateCreditNoteData): Promise<CreditNoteRecord> {
    const existing = await this.findByIdempotencyKey(data.idempotencyKey);
    if (existing) return existing;
    const now = new Date();
    const record: CreditNoteRecord = {
      id: `credit-note-${++creditNoteIdCounter}`,
      creditNoteNumber: null,
      status: "DRAFT",
      originalInvoiceId: data.originalInvoiceId,
      professionalProfileId: data.professionalProfileId,
      companyProfileId: data.companyProfileId,
      reason: data.reason,
      idempotencyKey: data.idempotencyKey,
      issueDate: null,
      currency: data.currency,
      lineItems: data.lineItems.map((item, i) => ({ id: `cn-line-${creditNoteIdCounter}-${i}`, ...item })),
      reversedTaxableBase: data.reversedTaxableBase,
      reversedVatRateBps: data.reversedVatRateBps,
      reversedVatAmount: data.reversedVatAmount,
      reversedCommissionAmount: data.reversedCommissionAmount,
      reversedIrpfWithholdingAmount: data.reversedIrpfWithholdingAmount,
      totalAmount: data.totalAmount,
      documentHash: null,
      cancelledAt: null,
      cancelledByUserId: null,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.push(record);
    return record;
  }

  async issue(data: IssueCreditNoteData): Promise<CreditNoteRecord> {
    const record = this.rows.find((r) => r.id === data.id);
    if (!record) throw new Error(`CreditNote ${data.id} not found.`);
    if (record.status !== "DRAFT") return record;
    record.status = "ISSUED";
    record.creditNoteNumber = data.creditNoteNumber;
    record.issueDate = data.issueDate;
    record.documentHash = data.documentHash;
    record.updatedAt = new Date();
    return record;
  }
}

/** Simple concurrency-safe-in-JS (single-threaded event loop) in-memory
 *  allocator — a real concurrency guarantee is verified against the
 *  actual Postgres SQL in `PrismaDocumentNumberAllocator`'s own doc
 *  comment; this fake exists only so `IssueInvoiceUseCase`/
 *  `CreateCreditNoteUseCase` tests never need a database. It still
 *  faithfully proves "N calls -> N distinct, never-duplicate values",
 *  which is what the numbering-uniqueness tests below assert. */
export class FakeInvoiceNumberAllocator implements InvoiceNumberAllocator {
  private counters = new Map<string, number>();

  async allocateNextInvoiceNumber(year: number): Promise<string> {
    return this.allocate("INV", year);
  }

  async allocateNextCreditNoteNumber(year: number): Promise<string> {
    return this.allocate("CN", year);
  }

  private async allocate(series: string, year: number): Promise<string> {
    const key = `${series}:${year}`;
    const next = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, next);
    return `${series}-${year}-${String(next).padStart(6, "0")}`;
  }
}

export class FakeEventBus implements EventBus {
  published: DomainEvent[] = [];
  private handlers = new Map<string, EventHandler[]>();

  async publish<T extends DomainEvent>(event: T): Promise<void> {
    this.published.push(event);
    const list = this.handlers.get(event.eventName) ?? [];
    for (const handler of list) {
      await handler.handle(event);
    }
  }

  async publishAll(events: DomainEvent[]): Promise<void> {
    for (const event of events) await this.publish(event);
  }

  subscribe<T extends DomainEvent>(eventType: DomainEventClass<T>, handler: EventHandler<T>): void {
    const list = this.handlers.get(eventType.eventName) ?? [];
    list.push(handler as EventHandler);
    this.handlers.set(eventType.eventName, list);
  }
}
