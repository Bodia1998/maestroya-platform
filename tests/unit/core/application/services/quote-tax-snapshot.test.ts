import { describe, expect, it } from "vitest";

import {
  QUOTE_TAX_SNAPSHOT_VERSION,
  computeQuoteTaxSnapshot,
} from "@/application/services/quote-tax-snapshot";
import { SPAIN_IVA_RATES_BPS } from "@/domain/services/spain-iva-calculator";

/**
 * Module 97 — Tax & IVA Production Integration, Phase 16 test list
 * ("Quote" items 11-13, and "Financial invariants" item 24).
 */
describe("computeQuoteTaxSnapshot", () => {
  const items = [
    { quantity: 1, unitPrice: 800, category: "LABOR" as const },
    { quantity: 1, unitPrice: 200, category: "MATERIALS" as const },
  ];

  it("11/12. persists a full snapshot where total = net (taxableBase) + tax (vatAmount)", () => {
    const snapshot = computeQuoteTaxSnapshot({
      items,
      customerType: "PRIVATE_CUSTOMER",
    });
    expect(snapshot.taxableBase).toBe(1000);
    expect(snapshot.vatRateBps).toBe(SPAIN_IVA_RATES_BPS.GENERAL);
    expect(snapshot.vatAmount).toBe(210);
    expect(snapshot.grossTotalAmount).toBe(snapshot.taxableBase + snapshot.vatAmount);
    expect(snapshot.grossTotalAmount).toBe(1210);
    expect(snapshot.taxCalculationVersion).toBe(QUOTE_TAX_SNAPSHOT_VERSION);
  });

  it("applies the community reduced rate end-to-end when every qualifying condition is met", () => {
    const snapshot = computeQuoteTaxSnapshot({
      items: [{ quantity: 1, unitPrice: 1000, category: "LABOR" }],
      customerType: "COMMUNITY_OF_OWNERS",
      operationType: "RENOVATION_OR_REPAIR",
      isResidentialProperty: true,
    });
    expect(snapshot.vatRateBps).toBe(SPAIN_IVA_RATES_BPS.REDUCED);
    expect(snapshot.vatAmount).toBe(100);
    expect(snapshot.grossTotalAmount).toBe(1100);
    expect(snapshot.taxClassificationCode).toBe("ES_COMMUNITY_QUALIFYING_RENOVATION_REDUCED");
    expect(snapshot.taxRequiresLegalConfirmation).toBe(true);
  });

  it("13. two calls with the same items but a caller-supplied different classification never mutate each other's results", () => {
    const first = computeQuoteTaxSnapshot({ items, customerType: "PRIVATE_CUSTOMER" });
    const second = computeQuoteTaxSnapshot({
      items,
      customerType: "COMMUNITY_OF_OWNERS",
      operationType: "RENOVATION_OR_REPAIR",
      isResidentialProperty: true,
    });
    expect(first.vatRateBps).toBe(SPAIN_IVA_RATES_BPS.GENERAL);
    expect(second.vatRateBps).toBe(SPAIN_IVA_RATES_BPS.REDUCED);
    // Each call is a fresh, independent computation — never a shared/mutated object.
    expect(first).not.toBe(second);
  });

  it("24. never drifts on rounding — taxableBase + vatAmount always sums exactly to grossTotalAmount", () => {
    const snapshot = computeQuoteTaxSnapshot({
      items: [{ quantity: 3, unitPrice: 33.33, category: "LABOR" }],
      customerType: "PRIVATE_CUSTOMER",
    });
    expect(snapshot.grossTotalAmount).toBe(snapshot.taxableBase + snapshot.vatAmount);
  });

  it("uses an injectable `now` for deterministic calculatedAt timestamps in tests", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const snapshot = computeQuoteTaxSnapshot({ items, customerType: "PRIVATE_CUSTOMER", now });
    expect(snapshot.taxCalculatedAt).toBe(now);
  });

  /**
   * Correction pass — "Correct Comunidad de Propietarios IVA Treatment,"
   * Step 6 (snapshot completeness) and Step 10 items 16-18.
   */
  describe("correction pass — snapshot completeness (Step 6)", () => {
    it("16. persists the Community classification context, not just a bare vatRate", () => {
      const snapshot = computeQuoteTaxSnapshot({
        items: [
          { quantity: 1, unitPrice: 700, category: "LABOR" },
          { quantity: 1, unitPrice: 300, category: "MATERIALS" },
        ],
        customerType: "COMMUNITY_OF_OWNERS",
        operationType: "MAINTENANCE",
        isResidentialProperty: true,
      });
      // Never "just vatRate = 10" (or 21) — the classification context
      // that produced it is always preserved alongside it.
      expect(snapshot.customerTypeAtQuote).toBe("COMMUNITY_OF_OWNERS");
      expect(snapshot.taxMaterialsAmount).toBe(300);
      expect(snapshot.taxClassificationCode).toBe("ES_COMMUNITY_NON_QUALIFYING_OPERATION_GENERAL");
    });

    it("17. persists the full 10% snapshot (rate, amount, classification, materials, legal-confirmation flag) when qualifying", () => {
      const snapshot = computeQuoteTaxSnapshot({
        items: [
          { quantity: 1, unitPrice: 800, category: "LABOR" },
          { quantity: 1, unitPrice: 200, category: "MATERIALS" },
        ],
        customerType: "COMMUNITY_OF_OWNERS",
        operationType: "RENOVATION_OR_REPAIR",
        isResidentialProperty: true,
      });
      expect(snapshot.vatRateBps).toBe(1000);
      expect(snapshot.taxMaterialsAmount).toBe(200);
      expect(snapshot.customerTypeAtQuote).toBe("COMMUNITY_OF_OWNERS");
      expect(snapshot.taxClassificationCode).toBe("ES_COMMUNITY_QUALIFYING_RENOVATION_REDUCED");
      expect(snapshot.taxRequiresLegalConfirmation).toBe(true);
    });

    it("18. a previously computed snapshot is a plain, independent value — recomputing later (as if the policy/config changed) never mutates it", () => {
      const original = computeQuoteTaxSnapshot({
        items: [{ quantity: 1, unitPrice: 1000, category: "LABOR" }],
        customerType: "COMMUNITY_OF_OWNERS",
        operationType: "RENOVATION_OR_REPAIR",
        isResidentialProperty: true,
      });
      const originalCopy = { ...original };

      // Simulate "tax configuration changed" by recomputing for a
      // different, non-qualifying operation on the same items.
      computeQuoteTaxSnapshot({
        items: [{ quantity: 1, unitPrice: 1000, category: "LABOR" }],
        customerType: "COMMUNITY_OF_OWNERS",
        operationType: "MAINTENANCE",
        isResidentialProperty: true,
      });

      // The first, already-returned snapshot is completely unaffected.
      expect(original).toEqual(originalCopy);
    });

    it("private customer and company snapshots never carry Community classification codes (10/11 — unchanged existing behavior)", () => {
      const privateSnapshot = computeQuoteTaxSnapshot({
        items: [{ quantity: 1, unitPrice: 1000, category: "LABOR" }],
        customerType: "PRIVATE_CUSTOMER",
      });
      const companySnapshot = computeQuoteTaxSnapshot({
        items: [{ quantity: 1, unitPrice: 1000, category: "LABOR" }],
        customerType: "COMPANY",
      });
      expect(privateSnapshot.taxClassificationCode).toBe("ES_STANDARD_GENERAL");
      expect(companySnapshot.taxClassificationCode).toBe("ES_STANDARD_GENERAL");
      expect(privateSnapshot.vatRateBps).toBe(2100);
      expect(companySnapshot.vatRateBps).toBe(2100);
    });
  });
});
