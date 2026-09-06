import { calculateQuoteItemAmount, calculateQuoteTotal, roundToCents } from "@/domain/services/money";
import { SPAIN_IVA_CALCULATOR } from "@/domain/services/spain-iva-calculator";
import {
  classifyCommunityIvaRate,
  type TaxClassificationCode,
} from "@/domain/services/spain-community-iva-classification-policy";
import type { CustomerTypeValue } from "@/domain/value-objects/customer-type";
import type { QuoteOperationTypeValue } from "@/domain/value-objects/quote-operation-type";

/**
 * Module 97 — Tax & IVA Production Integration, Phases 5-6.
 *
 * The single place `CreateQuoteUseCase`/`UpdateQuoteUseCase` compute a
 * Quote's persisted tax snapshot — reused by both rather than duplicated,
 * the same "one calculation, every caller reuses it" discipline
 * `calculateQuoteTotal` itself already establishes for the net total.
 *
 * Deliberately reuses (never re-derives):
 * - `calculateQuoteTotal`/`calculateQuoteItemAmount` (`domain/services/
 *   money.ts`) for the taxable base and the materials sub-total.
 * - `classifyCommunityIvaRate` (Module 97 Phase 3-4) for WHICH rate
 *   applies.
 * - `SPAIN_IVA_CALCULATOR` (Module 36) for the actual tax arithmetic —
 *   this file never computes `base * rateBps / 10000` itself.
 *
 * Bumping `QUOTE_TAX_SNAPSHOT_VERSION` is how a future change to this
 * calculation's *shape* (not its rate — rate changes never need a version
 * bump, they're just a different `rateBps` result) would be recorded
 * against already-persisted snapshots, without ever recalculating them.
 */
// Module 97 correction pass: bumped 1 -> 2 because this snapshot's SHAPE
// changed (customerTypeAtQuote/taxMaterialsAmount added) — see
// QuoteTaxSnapshot's own doc comment on those two fields. Never bumped
// for a rate change alone.
export const QUOTE_TAX_SNAPSHOT_VERSION = 2;

export interface QuoteTaxSnapshotItemInput {
  quantity: number;
  unitPrice: number;
  category?: "LABOR" | "MATERIALS";
}

export interface ComputeQuoteTaxSnapshotInput {
  items: QuoteTaxSnapshotItemInput[];
  customerType: CustomerTypeValue;
  operationType?: QuoteOperationTypeValue | null;
  isResidentialProperty?: boolean | null;
  /** Injectable for deterministic tests; defaults to `new Date()`. */
  now?: Date;
}

export interface QuoteTaxSnapshot {
  /** Module 97 correction pass (Step 6): the customer classification
   *  *as it was at the moment this snapshot was computed* — a
   *  `CustomerProfile.customerType` looked up later (e.g. an admin
   *  reclassifies the customer) must never change why an
   *  already-quoted rate was selected. Without this, the snapshot's
   *  `taxClassificationCode` would be unreproducible the moment
   *  `CustomerProfile.customerType` itself changes. */
  customerTypeAtQuote: CustomerTypeValue;
  taxableBase: number;
  /** Module 97 correction pass (Step 6): the MATERIALS-category portion
   *  of `taxableBase` that fed the materials-ratio test in
   *  `classifyCommunityIvaRate` — persisted so the classification is
   *  reproducible without recomputing it from `items[]` again (and so an
   *  audit never has to trust "materials ratio was X%" without the
   *  amount it was calculated from). Always 0 for a Quote whose
   *  classification never reached the materials-ratio step (e.g. a
   *  PRIVATE_CUSTOMER quote) — never omitted, so every persisted
   *  snapshot has the same shape regardless of which branch produced it. */
  taxMaterialsAmount: number;
  vatRateBps: number;
  vatAmount: number;
  /** `taxableBase + vatAmount` — Phase 6's "Quote total = net + tax." */
  grossTotalAmount: number;
  taxClassificationCode: TaxClassificationCode;
  taxRequiresLegalConfirmation: boolean;
  taxCalculationVersion: number;
  taxCalculatedAt: Date;
}

/**
 * Computes a Quote's authoritative tax snapshot from its own line items
 * and the customer's tax classification. Pure aside from `Date.now()`
 * (injectable via `now`) — never reads a database itself; callers pass in
 * whatever `CustomerProfile.customerType`/Quote-level operation facts they
 * already loaded, the same "derive server-side, from server-loaded data"
 * posture every other financial calculation in this codebase follows.
 */
export function computeQuoteTaxSnapshot(input: ComputeQuoteTaxSnapshotInput): QuoteTaxSnapshot {
  const taxableBase = calculateQuoteTotal(input.items);
  const materialsAmount = roundToCents(
    input.items
      .filter((item) => (item.category ?? "LABOR") === "MATERIALS")
      .reduce((sum, item) => sum + calculateQuoteItemAmount(item.quantity, item.unitPrice), 0),
  );

  const classification = classifyCommunityIvaRate({
    customerType: input.customerType,
    operationType: input.operationType,
    isResidentialProperty: input.isResidentialProperty,
    taxableAmount: taxableBase,
    materialsAmount,
  });

  const tax = SPAIN_IVA_CALCULATOR.calculate({
    taxableAmount: taxableBase,
    rateBps: classification.rateBps,
  });
  const grossTotalAmount = roundToCents(taxableBase + tax.taxAmount);

  return {
    customerTypeAtQuote: input.customerType,
    taxableBase,
    taxMaterialsAmount: materialsAmount,
    vatRateBps: tax.rateBps,
    vatAmount: tax.taxAmount,
    grossTotalAmount,
    taxClassificationCode: classification.classificationCode,
    taxRequiresLegalConfirmation: classification.requiresLegalConfirmation,
    taxCalculationVersion: QUOTE_TAX_SNAPSHOT_VERSION,
    taxCalculatedAt: input.now ?? new Date(),
  };
}
