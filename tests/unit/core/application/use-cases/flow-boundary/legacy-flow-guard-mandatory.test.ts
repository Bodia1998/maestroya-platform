import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  requireLegacyFlowGuard,
  shouldRunLegacyFlow,
} from "@/application/services/flow/transaction-flow-guard";
import { ProcessCustomerPaymentWebhookUseCase } from "@/application/use-cases/payments/process-customer-payment-webhook.use-case";
import { ExecuteProfessionalPayoutUseCase } from "@/application/use-cases/payments/execute-professional-payout.use-case";
import { InitiateQuotePaymentUseCase } from "@/application/use-cases/payments/initiate-quote-payment.use-case";
import { RecordCommissionForPaymentUseCase } from "@/application/use-cases/financial/record-commission-for-payment.use-case";
import { RecordAffiliateConversionOnPaymentReleaseApprovedSubscriber } from "@/application/use-cases/affiliate/record-affiliate-conversion-on-payment-release-approved.subscriber";
import { AcceptQuoteUseCase } from "@/application/use-cases/quotes/accept-quote.use-case";
import { CreateQuoteUseCase } from "@/application/use-cases/quotes/create-quote.use-case";
import { EvaluatePaymentReleaseUseCase } from "@/application/use-cases/job/evaluate-payment-release.use-case";
import { AdminResolvePaymentReleaseUseCase } from "@/application/use-cases/job/admin-resolve-payment-release.use-case";
import { CreateCustomerReceiptDraftUseCase } from "@/application/use-cases/invoicing/create-customer-receipt-draft.use-case";
import { CreateProfessionalInvoiceDraftUseCase } from "@/application/use-cases/invoicing/create-professional-invoice-draft.use-case";
import { legacyFlowGuardForTests } from "../../../../../test-utils/legacy-flow-guard";

/**
 * Module 131 — the legacy-flow guard is a MANDATORY constructor dependency of
 * every legacy-only component. A missing guard must fail at construction,
 * never silently skip isolation.
 */
const LEGACY_ONLY_USE_CASES = [
  ["ProcessCustomerPaymentWebhookUseCase", ProcessCustomerPaymentWebhookUseCase],
  ["ExecuteProfessionalPayoutUseCase", ExecuteProfessionalPayoutUseCase],
  ["InitiateQuotePaymentUseCase", InitiateQuotePaymentUseCase],
  ["RecordCommissionForPaymentUseCase", RecordCommissionForPaymentUseCase],
  ["AcceptQuoteUseCase", AcceptQuoteUseCase],
  ["CreateQuoteUseCase", CreateQuoteUseCase],
  ["EvaluatePaymentReleaseUseCase", EvaluatePaymentReleaseUseCase],
  ["AdminResolvePaymentReleaseUseCase", AdminResolvePaymentReleaseUseCase],
  ["CreateCustomerReceiptDraftUseCase", CreateCustomerReceiptDraftUseCase],
  ["CreateProfessionalInvoiceDraftUseCase", CreateProfessionalInvoiceDraftUseCase],
  [
    "RecordAffiliateConversionOnPaymentReleaseApprovedSubscriber",
    RecordAffiliateConversionOnPaymentReleaseApprovedSubscriber,
  ],
] as const;

const NO_ARGS: unknown[] = Array.from({ length: 30 }, () => undefined);

describe("Module 131 — mandatory guard dependency (fail-closed construction)", () => {
  it.each(LEGACY_ONLY_USE_CASES)(
    "%s throws at construction when no guard is supplied",
    (name, Ctor) => {
      const Construct = Ctor as unknown as new (...args: unknown[]) => unknown;
      expect(() => new Construct(...NO_ARGS)).toThrow(/requires a TransactionFlowGuard/);
      expect(() => new Construct(...NO_ARGS)).toThrow(name);
    },
  );

  it.each(LEGACY_ONLY_USE_CASES)("%s constructs when a guard is supplied", (_name, Ctor) => {
    const Construct = Ctor as unknown as new (...args: unknown[]) => unknown;
    const args = [...NO_ARGS];
    // The guard is always the last constructor parameter; try every slot.
    const guard = legacyFlowGuardForTests();
    const ok = args.some((_, i) => {
      const a = [...NO_ARGS];
      a[i] = guard;
      try {
        new Construct(...a);
        return true;
      } catch {
        return false;
      }
    });
    expect(ok).toBe(true);
  });

  it("requireLegacyFlowGuard rejects undefined and null", () => {
    expect(() => requireLegacyFlowGuard(undefined, "X")).toThrow(
      /X requires a TransactionFlowGuard/,
    );
    expect(() => requireLegacyFlowGuard(null, "X")).toThrow(/X requires a TransactionFlowGuard/);
    expect(() => requireLegacyFlowGuard(legacyFlowGuardForTests(), "X")).not.toThrow();
  });

  it("shouldRunLegacyFlow never treats a missing guard as 'proceed'", async () => {
    await expect(
      shouldRunLegacyFlow(undefined as never, "sr-1", "customer_payment.capture"),
    ).rejects.toThrow(/requires a TransactionFlowGuard/);
  });
});

describe("Module 131 — static contract: no optional / defaulted guard anywhere in src", () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (p.endsWith(".ts") || p.endsWith(".tsx")) out.push(p);
    }
    return out;
  }
  const files = walk(join(process.cwd(), "src"));

  it("no `flowGuard?:`, `flowGuard =`, `?.assertLegacy` or optional TransactionFlowGuard parameter exists", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      if (/flowGuard\s*\?\s*:/.test(src)) offenders.push(`${f}: optional flowGuard`);
      if (/flowGuard\s*(:\s*TransactionFlowGuard\s*)?=\s*/.test(src))
        offenders.push(`${f}: defaulted flowGuard`);
      if (/flowGuard\?\.assertLegacy/.test(src))
        offenders.push(`${f}: optional-chained assertLegacy`);
      if (/guard:\s*TransactionFlowGuard\s*\|\s*undefined/.test(src))
        offenders.push(`${f}: permissive guard parameter`);
    }
    expect(offenders).toEqual([]);
  });
});
