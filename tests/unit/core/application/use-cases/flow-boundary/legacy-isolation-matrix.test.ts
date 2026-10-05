import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import type { TransactionFlowReader } from "@/application/ports/transaction-flow-reader";
import { TransactionFlowGuard } from "@/application/services/flow/transaction-flow-guard";
import { AcceptQuoteUseCase } from "@/application/use-cases/quotes/accept-quote.use-case";
import { CreateQuoteUseCase } from "@/application/use-cases/quotes/create-quote.use-case";
import { RecordCommissionForPaymentUseCase } from "@/application/use-cases/financial/record-commission-for-payment.use-case";
import {
  LegacyFlowBoundaryError,
  type LegacyFinancialOperation,
  type TransactionFlowVersion,
} from "@/domain/services/transaction-flow";

/**
 * Module 131 — Legacy isolation matrix.
 *
 *   Legacy boundary                         | LEGACY_QUOTE_PAYMENT | LEAD_V1
 *   quote creation        (quote.create)    | allowed              | rejected
 *   quote acceptance      (quote.accept)    | allowed              | rejected
 *   payment initiation    (customer_payment.initiate)  | allowed   | rejected
 *   payment capture       (customer_payment.capture)   | allowed   | rejected
 *   commission            (commission.record)          | allowed   | rejected
 *   release evaluate/admin(payment_release.*)          | allowed   | rejected
 *   payout                (professional_payout.execute)| allowed   | rejected
 *   legacy invoice/receipt(invoice.*)                  | allowed   | rejected
 *   legacy affiliate      (affiliate.conversion_on_release) | allowed | rejected
 *
 * Layer 1: guard-level matrix over EVERY LegacyFinancialOperation.
 * Layer 2: use-case boundaries (the guard runs before any mutation).
 * Layer 3: static wiring — every operation is enforced by a real call site.
 * Behavioural LEAD_V1 tests for payment/capture/release/payout/invoice/
 * affiliate live in legacy-flow-boundary.test.ts (Module 121); repository
 * layer is in prisma-legacy-flow-repository-guards.test.ts.
 */
const ALL_OPERATIONS: LegacyFinancialOperation[] = [
  "quote.create",
  "quote.accept",
  "customer_payment.initiate",
  "customer_payment.capture",
  "commission.record",
  "payment_release.evaluate",
  "payment_release.admin_resolve",
  "professional_payout.execute",
  "invoice.professional_draft",
  "invoice.customer_receipt_draft",
  "affiliate.conversion_on_release",
];

function guardFor(flow: TransactionFlowVersion | null): TransactionFlowGuard {
  const reader: TransactionFlowReader = { findFlowVersion: async () => flow };
  return new TransactionFlowGuard(reader);
}

describe("Layer 1 — guard matrix over every legacy operation", () => {
  it.each(ALL_OPERATIONS)(
    "%s: LEGACY allowed, LEAD_V1 rejected, unknown flow rejected, missing request not allowed",
    async (op) => {
      await expect(
        guardFor("LEGACY_QUOTE_PAYMENT").assertLegacy("sr", op),
      ).resolves.toBeUndefined();
      await expect(guardFor("LEAD_V1").assertLegacy("sr", op)).rejects.toBeInstanceOf(
        LegacyFlowBoundaryError,
      );
      await expect(
        guardFor("SOMETHING_ELSE" as TransactionFlowVersion).assertLegacy("sr", op),
      ).rejects.toBeInstanceOf(LegacyFlowBoundaryError);
      await expect(guardFor(null).assertLegacy("sr", op)).rejects.toThrow();
    },
  );

  it("the operation list is exhaustive (static: matches the domain union)", () => {
    const src = readFileSync(
      join(process.cwd(), "src/core/domain/services/transaction-flow.ts"),
      "utf8",
    );
    const union = src.slice(
      src.indexOf("export type LegacyFinancialOperation"),
      src.indexOf("export class LegacyFlowBoundaryError"),
    );
    const declared = [...union.matchAll(/"([a-z_]+\.[a-z_]+)"/g)].map((m) => m[1]).sort();
    expect(declared).toEqual([...ALL_OPERATIONS].sort());
  });
});

const tripwireError = new Error("tripwire: dependency reached");
const tripwire = new Proxy(
  {},
  { get: (_t, prop) => (prop === "then" ? undefined : () => Promise.reject(tripwireError)) },
) as never;

describe("Layer 2 — use-case boundaries", () => {
  const request = { id: "sr-1", customerId: "c-1", customerUserId: "u-cust" };

  function createQuote(flow: TransactionFlowVersion) {
    const quotes = {
      findActiveByServiceRequestAndProfessional: vi.fn().mockRejectedValue(tripwireError),
      create: vi.fn(),
    };
    const useCase = new CreateQuoteUseCase(
      {
        findByUserId: async () => ({ id: "p-1", status: "ACTIVE", verificationStatus: "VERIFIED" }),
      } as never,
      { findCandidateById: async () => ({ id: "p-1" }) } as never,
      { findPublishedById: async () => request } as never,
      quotes as never,
      undefined,
      undefined,
      guardFor(flow),
    );
    return { useCase, quotes };
  }

  it("quote.create: LEAD_V1 rejected before any quote lookup/write", async () => {
    const { useCase, quotes } = createQuote("LEAD_V1");
    await expect(
      useCase.execute("u-pro", { serviceRequestId: "sr-1" } as never),
    ).rejects.toBeInstanceOf(LegacyFlowBoundaryError);
    expect(quotes.create).not.toHaveBeenCalled();
    expect(quotes.findActiveByServiceRequestAndProfessional).not.toHaveBeenCalled();
  });

  it("quote.create: LEGACY passes the guard (proceeds to the next dependency)", async () => {
    const { useCase } = createQuote("LEGACY_QUOTE_PAYMENT");
    await expect(
      useCase.execute("u-pro", { serviceRequestId: "sr-1" } as never),
    ).rejects.not.toBeInstanceOf(LegacyFlowBoundaryError);
  });

  function acceptQuote(flow: TransactionFlowVersion) {
    const quoteAcceptance = { acceptQuote: vi.fn() };
    const useCase = new AcceptQuoteUseCase(
      { findByUserId: async () => ({ id: "c-1" }) } as never,
      { findById: async () => ({ id: "sr-1", customerId: "c-1" }) } as never,
      tripwire,
      quoteAcceptance as never,
      undefined,
      undefined,
      undefined,
      guardFor(flow),
    );
    return { useCase, quoteAcceptance };
  }

  it("quote.accept: LEAD_V1 rejected; the acceptance transaction is never invoked", async () => {
    const { useCase, quoteAcceptance } = acceptQuote("LEAD_V1");
    await expect(useCase.execute("u-cust", "sr-1", "q-1")).rejects.toBeInstanceOf(
      LegacyFlowBoundaryError,
    );
    expect(quoteAcceptance.acceptQuote).not.toHaveBeenCalled();
  });

  it("quote.accept: LEGACY passes the guard", async () => {
    const { useCase } = acceptQuote("LEGACY_QUOTE_PAYMENT");
    await expect(useCase.execute("u-cust", "sr-1", "q-1")).rejects.not.toBeInstanceOf(
      LegacyFlowBoundaryError,
    );
  });

  it("commission.record: LEAD_V1 rejected before ledger/commission writes; LEGACY passes", async () => {
    const payments = {
      findById: async () => ({ id: "pay-1", serviceRequestId: "sr-1", status: "CAPTURED" }),
    };
    const build = (flow: TransactionFlowVersion) =>
      new RecordCommissionForPaymentUseCase(
        payments as never,
        tripwire,
        tripwire,
        tripwire,
        tripwire,
        guardFor(flow),
      );
    await expect(build("LEAD_V1").execute("pay-1")).rejects.toBeInstanceOf(LegacyFlowBoundaryError);
    await expect(build("LEGACY_QUOTE_PAYMENT").execute("pay-1")).rejects.not.toBeInstanceOf(
      LegacyFlowBoundaryError,
    );
  });
});

describe("Layer 3 — static wiring: every operation is enforced at a real call site", () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (p.endsWith(".ts")) out.push(p);
    }
    return out;
  }
  const sources = walk(join(process.cwd(), "src/core/application/use-cases")).map((f) =>
    readFileSync(f, "utf8"),
  );

  it.each(ALL_OPERATIONS)(
    "%s is passed to assertLegacy/shouldRunLegacyFlow in a use case",
    (op) => {
      const re = new RegExp(
        `(assertLegacy|shouldRunLegacyFlow)\\(\\s*[^)]*?"${op.replace(".", "\\.")}"`,
      );
      expect(sources.some((src) => re.test(src))).toBe(true);
    },
  );
});
