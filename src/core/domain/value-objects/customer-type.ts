/**
 * Module 97 — Tax & IVA Production Integration, Phase 3.
 *
 * A customer's tax classification. Deliberately identical to the Prisma
 * `CustomerType` enum (`prisma/schema.prisma`, CustomerProfile model) —
 * duplicated rather than imported from `@prisma/client`, the same
 * discipline `value-objects/materials-strategy.ts` already follows for
 * `MaterialsStrategyValue`.
 *
 * `COMMUNITY_OF_OWNERS` is necessary-but-not-sufficient for Spain's 10%
 * reduced IVA rate — see
 * `domain/services/spain-community-iva-classification-policy.ts` for the
 * full decision (operation type, property use, materials ratio) this
 * value alone never determines. Nothing in this file encodes a tax rate.
 */
export const CUSTOMER_TYPES = ["PRIVATE_CUSTOMER", "COMMUNITY_OF_OWNERS", "COMPANY"] as const;

export type CustomerTypeValue = (typeof CUSTOMER_TYPES)[number];

export function isCustomerType(value: unknown): value is CustomerTypeValue {
  return typeof value === "string" && (CUSTOMER_TYPES as readonly string[]).includes(value);
}

/** Conservative default applied everywhere a customer's classification
 *  isn't explicitly known — an ordinary consumer, no special tax
 *  treatment. Matches CustomerProfile.customerType's own DB default, so
 *  every CustomerProfile created before this module existed is
 *  (correctly) treated as PRIVATE_CUSTOMER. */
export const DEFAULT_CUSTOMER_TYPE: CustomerTypeValue = "PRIVATE_CUSTOMER";
