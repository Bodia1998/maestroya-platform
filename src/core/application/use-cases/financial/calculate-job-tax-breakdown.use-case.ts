import { NotFoundError } from "@/domain/errors/domain-error";
import type { CommissionRateRepository } from "@/domain/repositories/commission-rate-repository";
import type { JobRepository } from "@/domain/repositories/job-repository";
import type { QuoteRepository } from "@/domain/repositories/quote-repository";
import {
  calculateMaestroYaTaxBreakdown,
  type MaestroYaTaxCalculationResult,
} from "@/domain/services/maestroya-tax-calculation-service";
import type { TaxCalculatorRegistry } from "@/domain/services/tax-calculator";

export interface JobTaxBreakdownResult extends MaestroYaTaxCalculationResult {
  jobId: string;
  quoteId: string;
  professionalProfileId: string | null;
  companyProfileId: string | null;
  customerId: string;
  /** Module 97 correction pass: true when this breakdown's tax rate came
   *  from the Quote's own persisted classification snapshot
   *  (`Quote.vatRateBps`) rather than an explicit caller override or the
   *  tax calculator's bare general-rate default. Observability/testing
   *  signal only — never itself a financial decision. */
  usedQuoteTaxSnapshotRate: boolean;
}

export interface CalculateJobTaxBreakdownOptions {
  /** ISO 3166-1 alpha-2 country code; defaults to "ES" — MaestroYa
   *  currently operates in Spain only, same default every other
   *  Spain-only call site in this module uses. */
  countryCode?: string;
  /** Optional explicit IVA rate override — see
   *  `MaestroYaTaxCalculationInput.taxRateBps`'s own doc comment. Omit to
   *  use the resolved calculator's own default (Spain: 21%). */
  taxRateBps?: number;
  taxCalculators?: TaxCalculatorRegistry;
}

/**
 * Module 78 — IVA / Tax Integration: the single place that turns "a Job"
 * into a full Module 78 tax breakdown, mirroring
 * `CalculateJobCommissionBreakdownUseCase`'s own shape and role exactly
 * (same constructor dependencies, same "load Job -> load Quote -> derive
 * labour/materials from QuoteItem.category -> read current rates ->
 * delegate to the domain calculation" flow) — this is the reuse point the
 * Module 78 spec requires ("connect the existing financial components to
 * the new tax model," never re-derive the commission math or re-query
 * anything `CalculateJobCommissionBreakdownUseCase` already queries).
 *
 * ## The one deliberate deviation from `CalculateJobCommissionBreakdownUseCase`
 * That use case sums EVERY MATERIALS-category QuoteItem into its
 * commission base, regardless of `Quote.materialsStrategy`. Per the
 * Module 78 spec's Scenario A/B distinction (and confirmed against
 * `materials-procurement-rules.ts`/`quote-repository.ts`'s own doc
 * comments — a CUSTOMER_PURCHASED quote's materials checklist has no
 * price at all, so materials only become commissionable revenue when the
 * professional themselves purchased and priced them), this use case only
 * counts MATERIALS QuoteItems toward `professionalMaterialsAmount` when
 * `quote.materialsStrategy === "PROFESSIONAL_SUPPLIED"`. See
 * MODULE_78_IMPLEMENTATION_REPORT.md, "Problems found," for the full
 * writeup of why this is flagged as a contradiction rather than silently
 * patched into Module 64's own engine.
 *
 * ## Module 97 correction pass — "Invoice Tax Snapshot Integration"
 * Before this pass, `execute()` only ever used `options.taxRateBps` (an
 * explicit caller override) or, when omitted, silently fell through to
 * `calculateMaestroYaTaxBreakdown`'s own default: the resolved
 * calculator's general rate (Spain: 21%). Neither `CreateProfessionalInvoiceDraftUseCase`
 * nor `CreateCustomerReceiptDraftUseCase` ever supplied an override, so
 * EVERY invoice — including one for a Comunidad de Propietarios Job whose
 * Quote was correctly classified at 10% by
 * `classifyCommunityIvaRate`/`computeQuoteTaxSnapshot` (Module 97) — was
 * silently re-decided at 21% here, independently of the Quote's own
 * authoritative, persisted classification. This is the exact "Invoice
 * ignores the Quote tax snapshot" gap the correction pass's own report
 * identifies.
 *
 * The fix is the single line in `execute()` below: when the caller
 * doesn't explicitly override the rate, this use case now defaults to
 * `quote.vatRateBps` — the Quote's own persisted, immutable snapshot
 * field — before ever falling through to the calculator's own general
 * default. This is a REUSE of the override parameter
 * `calculateMaestroYaTaxBreakdown`/`SpainIvaCalculator.calculate` have
 * always had (see `tax-calculator.ts`'s own doc comment on
 * `TaxCalculationInput.rateBps`), not a second classification decision —
 * this file still never calls `classifyCommunityIvaRate` itself, and
 * still never reads "the current tax configuration" for this purpose.
 * Because this is the one place every invoice/credit-note code path
 * already goes through (`CreateProfessionalInvoiceDraftUseCase`,
 * `CreateCustomerReceiptDraftUseCase`, and — via its own call to this
 * same `execute()` — `CreateCreditNoteUseCase.deriveReversal`), fixing it
 * here fixes all three without touching any of them.
 *
 * A Quote created before Module 97 (or one whose classification is still
 * `null` for any other reason) has `vatRateBps: null` — `?? undefined`
 * below preserves EXACTLY today's fallback behavior for that quote
 * (general rate), so this is purely additive: no existing invoice
 * generation path for a non-classified Quote changes at all.
 */
export class CalculateJobTaxBreakdownUseCase {
  constructor(
    private readonly jobs: JobRepository,
    private readonly quotes: QuoteRepository,
    private readonly rates: CommissionRateRepository,
  ) {}

  async execute(
    jobId: string,
    options: CalculateJobTaxBreakdownOptions = {},
  ): Promise<JobTaxBreakdownResult> {
    const job = await this.jobs.findById(jobId);
    if (!job) {
      throw new NotFoundError("Job", jobId);
    }

    const quote = await this.quotes.findById(job.quoteId);
    if (!quote) {
      throw new NotFoundError("Quote", job.quoteId);
    }

    let labourAmount = 0;
    let professionalMaterialsAmount = 0;
    for (const item of quote.items) {
      if (item.category === "MATERIALS") {
        if (quote.materialsStrategy === "PROFESSIONAL_SUPPLIED") {
          professionalMaterialsAmount += item.amount;
        }
        // CUSTOMER_PURCHASED: never commissionable/taxable revenue for
        // MaestroYa — see this file's own doc comment.
      } else {
        labourAmount += item.amount;
      }
    }

    const rates = await this.rates.getCurrentRates();
    // Module 97 correction pass: an explicit caller override always wins
    // (existing behavior, unchanged); otherwise default to the Quote's
    // own persisted, immutable classification — never the calculator's
    // bare general-rate default — so this use case never independently
    // re-decides a rate the Quote already authoritatively settled. See
    // this class's own doc comment.
    const taxRateBps = options.taxRateBps ?? quote.vatRateBps ?? undefined;
    const breakdown = calculateMaestroYaTaxBreakdown({
      labourAmount,
      professionalMaterialsAmount,
      // QuoteMaterial (the CUSTOMER_PURCHASED checklist) has no price at
      // all — see quote-repository.ts's own doc comment — so there is
      // never a monetary amount to report here from the current domain
      // model. Kept explicit (rather than omitted) so this call site
      // documents *why* it's always 0 today.
      customerMaterialsAmount: 0,
      countryCode: options.countryCode ?? "ES",
      commissionRates: rates,
      taxRateBps,
      taxCalculators: options.taxCalculators,
    });

    return {
      ...breakdown,
      jobId: job.id,
      quoteId: quote.id,
      professionalProfileId: job.professionalProfileId,
      companyProfileId: job.companyProfileId,
      customerId: job.customerId,
      // Module 97 correction pass: observability/testability signal —
      // true whenever this breakdown's rate came from the Quote's own
      // persisted classification rather than an explicit caller override
      // or the calculator's bare default. Never used for any financial
      // decision itself.
      usedQuoteTaxSnapshotRate: options.taxRateBps === undefined && quote.vatRateBps != null,
    };
  }
}
