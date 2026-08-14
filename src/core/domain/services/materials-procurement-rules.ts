import { MaterialsListRequiredError, ValidationError } from "@/domain/errors/domain-error";
import type { QuoteMaterialInput } from "@/domain/repositories/quote-repository";
import type { MaterialsStrategyValue } from "@/domain/value-objects/materials-strategy";

/**
 * Module 63 — Materials Procurement Workflow: pure, dependency-free domain
 * rules for the materials-strategy business logic — same "small stateless
 * helper" convention as quote-state.ts/quote-eligibility.ts/money.ts. Never
 * imports Prisma or any repository implementation; every use case that
 * needs one of these checks calls it after fetching whatever data it
 * needs itself (mirrors quote-eligibility.ts's own "caller fetches, this
 * file only decides" split).
 */

export const MAX_MATERIALS_ITEMS = 50;
export const MAX_MATERIAL_NAME_LENGTH = 200;
export const MAX_MATERIAL_BRAND_LENGTH = 100;
export const MAX_MATERIAL_MODEL_LENGTH = 100;
export const MAX_MATERIAL_NOTES_LENGTH = 1000;
export const MAX_MATERIAL_QUANTITY = 100000;

/**
 * True whenever this Quote's materials strategy requires the customer to
 * purchase materials themselves — the single predicate every other rule
 * in this file, plus StartJobUseCase's gating check, is built on top of.
 */
export function requiresCustomerPurchasedMaterials(strategy: MaterialsStrategyValue): boolean {
  return strategy === "CUSTOMER_PURCHASED";
}

/**
 * Validates the shape of a single required-materials checklist entry.
 * Deliberately does NOT validate the strategy/emptiness rule (see
 * `assertValidMaterialsList` for that) — this only checks one item is
 * internally well-formed, so it composes cleanly whether called from a
 * DTO-level Zod refinement or straight from a use case.
 */
export function isValidMaterialInput(material: QuoteMaterialInput): boolean {
  const name = material.name?.trim() ?? "";
  if (name.length === 0 || name.length > MAX_MATERIAL_NAME_LENGTH) return false;
  if (!Number.isFinite(material.quantity) || material.quantity <= 0 || material.quantity > MAX_MATERIAL_QUANTITY) {
    return false;
  }
  if (material.brand != null && material.brand.length > MAX_MATERIAL_BRAND_LENGTH) return false;
  if (material.model != null && material.model.length > MAX_MATERIAL_MODEL_LENGTH) return false;
  if (material.notes != null && material.notes.length > MAX_MATERIAL_NOTES_LENGTH) return false;
  return true;
}

/**
 * The module's central creation-time rule: "If Purchased by customer, the
 * professional must provide a required materials list." Called by
 * CreateQuoteUseCase/UpdateQuoteUseCase after DTO validation, as the
 * authoritative server-side check (the DTO layer's own Zod refinement
 * mirrors this for fast client-side feedback, but this is what every use
 * case actually trusts — same "DTO is UX, domain service is the real
 * gate" split every other module in this codebase follows).
 *
 * - PROFESSIONAL_SUPPLIED: the materials list is ignored entirely (never
 *   persisted) — this is intentionally permissive so a caller doesn't need
 *   to remember to omit/clear it when switching strategy back.
 * - CUSTOMER_PURCHASED: at least one well-formed material is required, and
 *   at most MAX_MATERIALS_ITEMS; every item must pass
 *   `isValidMaterialInput`.
 */
export function assertValidMaterialsList(
  strategy: MaterialsStrategyValue,
  materials: readonly QuoteMaterialInput[],
): void {
  if (!requiresCustomerPurchasedMaterials(strategy)) return;

  if (materials.length === 0) {
    throw new MaterialsListRequiredError();
  }
  if (materials.length > MAX_MATERIALS_ITEMS) {
    throw new ValidationError(`A materials list can have at most ${MAX_MATERIALS_ITEMS} items.`);
  }
  for (const material of materials) {
    if (!isValidMaterialInput(material)) {
      throw new ValidationError("Every material needs a name and a quantity greater than zero.");
    }
  }
}

/**
 * The module's core customer-facing rule, restated as a pure predicate:
 * "The booking cannot begin until the customer confirms that all required
 * materials have been purchased." `StartJobUseCase` is the sole enforcement
 * point (see its own doc comment) — this function only decides, it never
 * queries anything itself.
 *
 * - PROFESSIONAL_SUPPLIED: always true — current behavior, unaffected by
 *   this module.
 * - CUSTOMER_PURCHASED: true only once `materialsConfirmedAt` is set (see
 *   `ConfirmMaterialsPurchasedUseCase`).
 */
export function canStartJobGivenMaterials(
  strategy: MaterialsStrategyValue,
  materialsConfirmedAt: Date | null,
): boolean {
  if (!requiresCustomerPurchasedMaterials(strategy)) return true;
  return materialsConfirmedAt !== null;
}

/**
 * Whether a materials-purchase confirmation action even makes sense for
 * this Quote right now — used by `ConfirmMaterialsPurchasedUseCase` to
 * reject confirming a PROFESSIONAL_SUPPLIED quote (nothing to confirm) or
 * re-confirming an already-confirmed one (idempotency is handled as a
 * no-op error, not a silent double-write).
 */
export function canConfirmMaterialsPurchase(
  strategy: MaterialsStrategyValue,
  materialsConfirmedAt: Date | null,
): boolean {
  return requiresCustomerPurchasedMaterials(strategy) && materialsConfirmedAt === null;
}
