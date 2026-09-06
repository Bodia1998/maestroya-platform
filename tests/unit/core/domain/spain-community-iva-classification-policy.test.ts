import { describe, expect, it } from "vitest";

import { TaxCalculationError } from "@/domain/errors/domain-error";
import {
  COMMUNITY_REDUCED_RATE_MAX_MATERIALS_RATIO,
  classifyCommunityIvaRate,
} from "@/domain/services/spain-community-iva-classification-policy";
import { SPAIN_IVA_RATES_BPS } from "@/domain/services/spain-iva-calculator";

/**
 * Module 97 — Tax & IVA Production Integration, Phase 16 test list
 * ("Tax engine" items 1-6, 8-9). Mirrors spain-iva-calculator.test.ts's
 * own style.
 */
describe("classifyCommunityIvaRate", () => {
  it("1. private customer: always general rate, regardless of operation facts", () => {
    const result = classifyCommunityIvaRate({
      customerType: "PRIVATE_CUSTOMER",
      operationType: "RENOVATION_OR_REPAIR",
      isResidentialProperty: true,
      taxableAmount: 1000,
      materialsAmount: 0,
    });
    expect(result.rateBps).toBe(SPAIN_IVA_RATES_BPS.GENERAL);
    expect(result.classificationCode).toBe("ES_STANDARD_GENERAL");
    expect(result.requiresLegalConfirmation).toBe(false);
  });

  it("5. company customer: always general rate — this policy's scope is Community only", () => {
    const result = classifyCommunityIvaRate({
      customerType: "COMPANY",
      operationType: "RENOVATION_OR_REPAIR",
      isResidentialProperty: true,
      taxableAmount: 1000,
      materialsAmount: 100,
    });
    expect(result.rateBps).toBe(SPAIN_IVA_RATES_BPS.GENERAL);
    expect(result.classificationCode).toBe("ES_STANDARD_GENERAL");
  });

  it("2. community, qualifying renovation on a residential property, materials within threshold -> 10% reduced", () => {
    const result = classifyCommunityIvaRate({
      customerType: "COMMUNITY_OF_OWNERS",
      operationType: "RENOVATION_OR_REPAIR",
      isResidentialProperty: true,
      taxableAmount: 1000,
      materialsAmount: 300,
    });
    expect(result.rateBps).toBe(SPAIN_IVA_RATES_BPS.REDUCED);
    expect(result.classificationCode).toBe("ES_COMMUNITY_QUALIFYING_RENOVATION_REDUCED");
    // Never legally final on this policy's authority alone.
    expect(result.requiresLegalConfirmation).toBe(true);
  });

  it("3. community, ordinary maintenance -> general rate, not reduced", () => {
    const result = classifyCommunityIvaRate({
      customerType: "COMMUNITY_OF_OWNERS",
      operationType: "MAINTENANCE",
      isResidentialProperty: true,
      taxableAmount: 1000,
      materialsAmount: 100,
    });
    expect(result.rateBps).toBe(SPAIN_IVA_RATES_BPS.GENERAL);
    expect(result.classificationCode).toBe("ES_COMMUNITY_NON_QUALIFYING_OPERATION_GENERAL");
    expect(result.requiresLegalConfirmation).toBe(false);
  });

  it('6. community, "OTHER" operation type -> general rate', () => {
    const result = classifyCommunityIvaRate({
      customerType: "COMMUNITY_OF_OWNERS",
      operationType: "OTHER",
      isResidentialProperty: true,
      taxableAmount: 1000,
      materialsAmount: 0,
    });
    expect(result.rateBps).toBe(SPAIN_IVA_RATES_BPS.GENERAL);
    expect(result.classificationCode).toBe("ES_COMMUNITY_NON_QUALIFYING_OPERATION_GENERAL");
  });

  it("4. community, qualifying renovation, but material-heavy (over the ratio threshold) -> general rate", () => {
    const result = classifyCommunityIvaRate({
      customerType: "COMMUNITY_OF_OWNERS",
      operationType: "RENOVATION_OR_REPAIR",
      isResidentialProperty: true,
      taxableAmount: 1000,
      materialsAmount: 500, // 50% > 40% threshold
    });
    expect(result.rateBps).toBe(SPAIN_IVA_RATES_BPS.GENERAL);
    expect(result.classificationCode).toBe("ES_COMMUNITY_MATERIAL_HEAVY_GENERAL");
    expect(result.requiresLegalConfirmation).toBe(true);
  });

  it("is exactly at the materials-ratio threshold -> still qualifies (boundary is inclusive)", () => {
    const result = classifyCommunityIvaRate({
      customerType: "COMMUNITY_OF_OWNERS",
      operationType: "RENOVATION_OR_REPAIR",
      isResidentialProperty: true,
      taxableAmount: 1000,
      materialsAmount: 1000 * COMMUNITY_REDUCED_RATE_MAX_MATERIALS_RATIO,
    });
    expect(result.classificationCode).toBe("ES_COMMUNITY_QUALIFYING_RENOVATION_REDUCED");
  });

  it("community, renovation, but non-residential property -> general rate", () => {
    const result = classifyCommunityIvaRate({
      customerType: "COMMUNITY_OF_OWNERS",
      operationType: "RENOVATION_OR_REPAIR",
      isResidentialProperty: false,
      taxableAmount: 1000,
      materialsAmount: 100,
    });
    expect(result.rateBps).toBe(SPAIN_IVA_RATES_BPS.GENERAL);
    expect(result.classificationCode).toBe("ES_COMMUNITY_NON_RESIDENTIAL_GENERAL");
    expect(result.requiresLegalConfirmation).toBe(false);
  });

  it("6/9. community with missing operation data -> insufficient data, safely defaults to general, flags for legal confirmation (never guesses reduced)", () => {
    const missingOperationType = classifyCommunityIvaRate({
      customerType: "COMMUNITY_OF_OWNERS",
      isResidentialProperty: true,
      taxableAmount: 1000,
      materialsAmount: 0,
    });
    expect(missingOperationType.rateBps).toBe(SPAIN_IVA_RATES_BPS.GENERAL);
    expect(missingOperationType.classificationCode).toBe("ES_COMMUNITY_INSUFFICIENT_DATA_DEFAULTED_GENERAL");
    expect(missingOperationType.requiresLegalConfirmation).toBe(true);

    const missingPropertyUse = classifyCommunityIvaRate({
      customerType: "COMMUNITY_OF_OWNERS",
      operationType: "RENOVATION_OR_REPAIR",
      taxableAmount: 1000,
      materialsAmount: 0,
    });
    expect(missingPropertyUse.classificationCode).toBe("ES_COMMUNITY_INSUFFICIENT_DATA_DEFAULTED_GENERAL");
  });

  it("8. zero taxable amount never divides by zero and never reduces", () => {
    const result = classifyCommunityIvaRate({
      customerType: "COMMUNITY_OF_OWNERS",
      operationType: "RENOVATION_OR_REPAIR",
      isResidentialProperty: true,
      taxableAmount: 0,
      materialsAmount: 0,
    });
    expect(result.classificationCode).toBe("ES_COMMUNITY_QUALIFYING_RENOVATION_REDUCED");
    expect(result.rateBps).toBe(SPAIN_IVA_RATES_BPS.REDUCED);
  });

  it("9. rejects a negative taxableAmount", () => {
    expect(() =>
      classifyCommunityIvaRate({
        customerType: "PRIVATE_CUSTOMER",
        taxableAmount: -1,
        materialsAmount: 0,
      }),
    ).toThrow(TaxCalculationError);
  });

  it("rejects materialsAmount greater than taxableAmount", () => {
    expect(() =>
      classifyCommunityIvaRate({
        customerType: "COMMUNITY_OF_OWNERS",
        operationType: "RENOVATION_OR_REPAIR",
        isResidentialProperty: true,
        taxableAmount: 100,
        materialsAmount: 200,
      }),
    ).toThrow(TaxCalculationError);
  });

  it("10. is deterministic — same input, same output, every time", () => {
    const input = {
      customerType: "COMMUNITY_OF_OWNERS" as const,
      operationType: "RENOVATION_OR_REPAIR" as const,
      isResidentialProperty: true,
      taxableAmount: 1234.56,
      materialsAmount: 400,
    };
    const results = Array.from({ length: 5 }, () => classifyCommunityIvaRate(input));
    for (const result of results) {
      expect(result).toEqual(results[0]);
    }
  });

  /**
   * Correction pass — "Correct Comunidad de Propietarios IVA Treatment,"
   * Step 10 test list (materials-ratio boundary precision + repair vs.
   * renovation + private/company unchanged, mapped onto that list's own
   * numbering).
   */
  describe("correction pass — materials-ratio boundary precision (Step 5/10)", () => {
    it("5. materials at 39.99% of the base -> eligible", () => {
      const result = classifyCommunityIvaRate({
        customerType: "COMMUNITY_OF_OWNERS",
        operationType: "RENOVATION_OR_REPAIR",
        isResidentialProperty: true,
        taxableAmount: 1000,
        materialsAmount: 399.9,
      });
      expect(result.classificationCode).toBe("ES_COMMUNITY_QUALIFYING_RENOVATION_REDUCED");
    });

    it("6. materials at exactly 40.00% of the base -> still eligible (inclusive boundary)", () => {
      const result = classifyCommunityIvaRate({
        customerType: "COMMUNITY_OF_OWNERS",
        operationType: "RENOVATION_OR_REPAIR",
        isResidentialProperty: true,
        taxableAmount: 1000,
        materialsAmount: 400,
      });
      expect(result.classificationCode).toBe("ES_COMMUNITY_QUALIFYING_RENOVATION_REDUCED");
    });

    it("7. materials at 40.01% of the base -> NOT eligible", () => {
      const result = classifyCommunityIvaRate({
        customerType: "COMMUNITY_OF_OWNERS",
        operationType: "RENOVATION_OR_REPAIR",
        isResidentialProperty: true,
        taxableAmount: 1000,
        materialsAmount: 400.1,
      });
      expect(result.classificationCode).toBe("ES_COMMUNITY_MATERIAL_HEAVY_GENERAL");
    });

    it("never drifts across amounts prone to IEEE-754 division imprecision (e.g. thirds of a cent-precise base)", () => {
      // 333.33 / 833.33 ~= 39.9997...% by float division but this policy
      // never divides for the eligibility decision — see
      // isWithinMaterialsThreshold's own doc comment.
      const result = classifyCommunityIvaRate({
        customerType: "COMMUNITY_OF_OWNERS",
        operationType: "RENOVATION_OR_REPAIR",
        isResidentialProperty: true,
        taxableAmount: 833.33,
        materialsAmount: 333.33,
      });
      expect(result.classificationCode).toBe("ES_COMMUNITY_QUALIFYING_RENOVATION_REDUCED");
    });
  });

  describe("correction pass — repair and renovation are treated identically (Step 2)", () => {
    it("1/2. both map to the same single qualifying operationType value and produce identical outcomes", () => {
      // See this policy file's own "Repair vs. renovation" doc comment for
      // why QuoteOperationTypeValue has one RENOVATION_OR_REPAIR value
      // rather than separate REPAIR/RENOVATION values.
      const result = classifyCommunityIvaRate({
        customerType: "COMMUNITY_OF_OWNERS",
        operationType: "RENOVATION_OR_REPAIR",
        isResidentialProperty: true,
        taxableAmount: 1000,
        materialsAmount: 100,
      });
      expect(result.classificationCode).toBe("ES_COMMUNITY_QUALIFYING_RENOVATION_REDUCED");
      expect(result.rateBps).toBe(SPAIN_IVA_RATES_BPS.REDUCED);
    });
  });

  describe("correction pass — explicit UNKNOWN-operation-type case never silently applies 10% (Step 4)", () => {
    it('4. community + operationType omitted ("unknown") -> unresolved/general, never a silent 10%', () => {
      const result = classifyCommunityIvaRate({
        customerType: "COMMUNITY_OF_OWNERS",
        isResidentialProperty: true,
        taxableAmount: 1000,
        materialsAmount: 100,
      });
      expect(result.rateBps).not.toBe(SPAIN_IVA_RATES_BPS.REDUCED);
      expect(result.rateBps).toBe(SPAIN_IVA_RATES_BPS.GENERAL);
      expect(result.classificationCode).toBe("ES_COMMUNITY_INSUFFICIENT_DATA_DEFAULTED_GENERAL");
      // The deterministic "legal confirmation required / unresolved" signal
      // this task's Step 4 asks for — this codebase's existing equivalent
      // of a "reducedRateEligible: unknown" state, reused rather than
      // duplicated (Step 4's own "do not invent a new state if an existing
      // equivalent exists" instruction).
      expect(result.requiresLegalConfirmation).toBe(true);
    });
  });
});
