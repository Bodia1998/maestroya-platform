import { describe, expect, it } from "vitest";

import { createQuoteSchema } from "@/application/dto/quote.dto";

/**
 * Module 97 correction pass — "Correct Comunidad de Propietarios IVA
 * Treatment," Step 12 (security): the customer/professional-facing
 * `createQuoteSchema` has no field for `vatRateBps`/`vatRate`/`taxRate`/
 * `taxClassificationCode` at all — the IVA rate is always computed
 * server-side by `computeQuoteTaxSnapshot`
 * (application/services/quote-tax-snapshot.ts), from
 * `CustomerProfile.customerType` (server-loaded) plus the caller-supplied
 * `operationType`/`isResidentialProperty` FACTS about the job — never a
 * rate itself. Zod's default "strip unknown keys" behavior means even a
 * client that tries to smuggle a rate field in the request body has it
 * silently dropped before `CreateQuoteUseCase` ever sees it.
 */
describe("createQuoteSchema — server owns the IVA rate (Step 12)", () => {
  const basePayload = {
    serviceRequestId: "11111111-1111-1111-1111-111111111111",
    items: [{ description: "Boiler repair", quantity: 1, unitPrice: 100 }],
  };

  it("strips a client-supplied vatRateBps — it never reaches CreateQuoteInput", () => {
    const parsed = createQuoteSchema.parse({ ...basePayload, vatRateBps: 1000 });
    expect(parsed).not.toHaveProperty("vatRateBps");
  });

  it("strips a client-supplied vatRate/taxRate/taxClassificationCode/requiresLegalConfirmation override", () => {
    const parsed = createQuoteSchema.parse({
      ...basePayload,
      vatRate: 10,
      taxRate: 0.1,
      taxClassificationCode: "ES_COMMUNITY_QUALIFYING_RENOVATION_REDUCED",
      taxRequiresLegalConfirmation: false,
    });
    expect(parsed).not.toHaveProperty("vatRate");
    expect(parsed).not.toHaveProperty("taxRate");
    expect(parsed).not.toHaveProperty("taxClassificationCode");
    expect(parsed).not.toHaveProperty("taxRequiresLegalConfirmation");
  });

  it("only accepts factual operationType/isResidentialProperty inputs about the job, never a rate", () => {
    const parsed = createQuoteSchema.parse({
      ...basePayload,
      operationType: "RENOVATION_OR_REPAIR",
      isResidentialProperty: true,
    });
    expect(parsed.operationType).toBe("RENOVATION_OR_REPAIR");
    expect(parsed.isResidentialProperty).toBe(true);
    expect(parsed).not.toHaveProperty("vatRateBps");
  });

  it("rejects an invalid operationType rather than silently accepting an arbitrary string", () => {
    expect(() => createQuoteSchema.parse({ ...basePayload, operationType: "SOMETHING_MADE_UP" })).toThrow();
  });
});
