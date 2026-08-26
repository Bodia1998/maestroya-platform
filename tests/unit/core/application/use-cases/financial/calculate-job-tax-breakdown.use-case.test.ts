import { beforeEach, describe, expect, it } from "vitest";

import { NotFoundError } from "@/domain/errors/domain-error";
import type { CommissionRateRepository } from "@/domain/repositories/commission-rate-repository";
import type { JobRecord, JobRepository } from "@/domain/repositories/job-repository";
import type { QuoteRecord, QuoteRepository } from "@/domain/repositories/quote-repository";
import { DEFAULT_COMMISSION_RATES } from "@/domain/services/commission-policy";
import { CalculateJobTaxBreakdownUseCase } from "@/application/use-cases/financial/calculate-job-tax-breakdown.use-case";

/**
 * Module 78 — IVA / Tax Integration: in-memory fakes for this use case's
 * own test — same "one fakes set per module's own test file" convention
 * every other module's use-case tests already follow (see
 * `tests/unit/core/application/use-cases/payments/fakes.ts`).
 */

class FakeJobRepository implements Pick<JobRepository, "findById"> {
  byId = new Map<string, JobRecord>();
  seed(record: JobRecord): void {
    this.byId.set(record.id, record);
  }
  async findById(id: string): Promise<JobRecord | null> {
    return this.byId.get(id) ?? null;
  }
}

class FakeQuoteRepository implements Pick<QuoteRepository, "findById"> {
  byId = new Map<string, QuoteRecord>();
  seed(record: QuoteRecord): void {
    this.byId.set(record.id, record);
  }
  async findById(id: string): Promise<QuoteRecord | null> {
    return this.byId.get(id) ?? null;
  }
}

class FakeCommissionRateRepository implements CommissionRateRepository {
  rates = DEFAULT_COMMISSION_RATES;
  async getCurrentRates() {
    return this.rates;
  }
}

function makeJob(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: "job-1",
    serviceRequestId: "sr-1",
    quoteId: "quote-1",
    customerId: "customer-1",
    professionalProfileId: "professional-1",
    companyProfileId: null,
    status: "COMPLETED",
    startedAt: null,
    startedByUserId: null,
    completedAt: null,
    completedByUserId: null,
    cancelledAt: null,
    cancelledByUserId: null,
    cancellationReason: null,
    cancellationNote: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeQuote(overrides: Partial<QuoteRecord> = {}): QuoteRecord {
  return {
    id: "quote-1",
    serviceRequestId: "sr-1",
    professionalProfileId: "professional-1",
    submittedByUserId: "user-1",
    status: "ACCEPTED",
    totalAmount: 1200,
    currency: "EUR",
    validUntil: null,
    notes: null,
    items: [
      { id: "item-labour", description: "Labour", quantity: 1, unitPrice: 1000, amount: 1000, sortOrder: 0, category: "LABOR" },
      { id: "item-materials", description: "Materials", quantity: 1, unitPrice: 200, amount: 200, sortOrder: 1, category: "MATERIALS" },
    ],
    materialsStrategy: "PROFESSIONAL_SUPPLIED",
    materials: [],
    materialsConfirmedAt: null,
    materialsConfirmedByUserId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("CalculateJobTaxBreakdownUseCase", () => {
  let jobs: FakeJobRepository;
  let quotes: FakeQuoteRepository;
  let rates: FakeCommissionRateRepository;
  let useCase: CalculateJobTaxBreakdownUseCase;

  beforeEach(() => {
    jobs = new FakeJobRepository();
    quotes = new FakeQuoteRepository();
    rates = new FakeCommissionRateRepository();
    // Cast: the use case only needs `findById` from these repositories,
    // matching the interfaces at the call sites it actually uses.
    useCase = new CalculateJobTaxBreakdownUseCase(jobs as unknown as JobRepository, quotes as unknown as QuoteRepository, rates);
  });

  it("computes the canonical Module 78 breakdown for a PROFESSIONAL_SUPPLIED quote (Scenario A)", async () => {
    jobs.seed(makeJob());
    quotes.seed(makeQuote());

    const result = await useCase.execute("job-1");

    expect(result.jobId).toBe("job-1");
    expect(result.quoteId).toBe("quote-1");
    expect(result.customerId).toBe("customer-1");
    expect(result.professionalProfileId).toBe("professional-1");
    expect(result.labourBase).toBe(1000);
    expect(result.professionalMaterialsBase).toBe(200);
    expect(result.customerTaxableBase).toBe(1200);
    expect(result.customerVatAmount).toBe(252);
    expect(result.customerGrossTotal).toBe(1452);
    expect(result.commissionAmount).toBe(120);
    expect(result.professionalNetBase).toBe(1080);
    expect(result.professionalVatAmount).toBe(226.8);
    expect(result.professionalInvoiceGrossTotal).toBe(1306.8);
    expect(result.irpfWithholdingAmount).toBe(0);
  });

  it("excludes priced MATERIALS items from commission/tax when materialsStrategy is CUSTOMER_PURCHASED (Scenario B)", async () => {
    jobs.seed(makeJob());
    quotes.seed(
      makeQuote({
        materialsStrategy: "CUSTOMER_PURCHASED",
        // Even if a MATERIALS QuoteItem is somehow present (see the
        // use case's own doc comment on this pre-existing domain gap),
        // it must never be commissioned or taxed for a CUSTOMER_PURCHASED
        // quote.
        items: [
          { id: "item-labour", description: "Labour", quantity: 1, unitPrice: 1000, amount: 1000, sortOrder: 0, category: "LABOR" },
          { id: "item-materials", description: "Materials", quantity: 1, unitPrice: 200, amount: 200, sortOrder: 1, category: "MATERIALS" },
        ],
      }),
    );

    const result = await useCase.execute("job-1");

    expect(result.labourBase).toBe(1000);
    expect(result.professionalMaterialsBase).toBe(0);
    expect(result.customerTaxableBase).toBe(1000);
    expect(result.customerVatAmount).toBe(210);
    expect(result.commissionAmount).toBe(100);
    expect(result.professionalNetBase).toBe(900);
  });

  it("throws NotFoundError for an unknown job", async () => {
    await expect(useCase.execute("missing-job")).rejects.toThrow(NotFoundError);
  });

  it("throws NotFoundError when the job's quote cannot be found", async () => {
    jobs.seed(makeJob({ quoteId: "missing-quote" }));
    await expect(useCase.execute("job-1")).rejects.toThrow(NotFoundError);
  });

  it("reads the current commission rate from CommissionRateRepository rather than a hardcoded literal", async () => {
    jobs.seed(makeJob());
    quotes.seed(makeQuote());
    rates.rates = { commissionRateBps: 500 }; // 5% override

    const result = await useCase.execute("job-1");
    expect(result.commissionRateBps).toBe(500);
    expect(result.commissionAmount).toBe(60);
  });
});
