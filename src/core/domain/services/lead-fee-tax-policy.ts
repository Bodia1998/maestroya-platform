import { formatScaledDecimal, parseScaledDecimal } from "@/domain/services/fixed-point-decimal";

/**
 * Module 136 — LEAD_V1 lead-fee tax computation policy (pure, deterministic, no I/O).
 *
 * Authoritative business rule: every LEAD_V1 lead fee is subject to Spanish IVA
 * at 21%. The lead fee stored by M133/M135 (`LeadPurchase.price`) is the NET
 * amount before IVA, so the professional pays MaestroYa
 *
 *     price + taxAmount,  taxAmount = round(price × 21%, 2)
 *
 * e.g. €100.00 + €21.00 IVA = €121.00. The rate is NOT configurable and not a
 * legal question for this policy: `LEAD_FEE_IVA_RATE_BPS` below is its single
 * source. `LEAD_FEE_TAX_POLICY_VERSION` identifies the calculation rules that
 * produced a stored snapshot (audit provenance); it does not make the rate a
 * runtime setting. A different rate would be a NEW policy version, and purchases
 * snapshotted under v1 would keep their stored amounts.
 *
 * Arithmetic is fixed-point `bigint` cents only — never a JS `number`.
 * This policy knows nothing about the customer's job payment (out of scope).
 */
export const LEAD_FEE_TAX_POLICY_VERSION = "lead-fee-tax-policy-v1";

/** The ONE place the LEAD_V1 IVA rate lives: 21.00% expressed in basis points. */
export const LEAD_FEE_IVA_RATE_BPS = 2100n;

const BPS_DENOMINATOR = 10_000n;

/**
 * Explicit rounding mode: ROUND_HALF_UP to whole cents (a fraction of exactly
 * half a cent rounds up). Amounts are non-negative, so this equals PostgreSQL's
 * `round(numeric, 2)` (half away from zero) and the Spain IVA convention.
 */
export const LEAD_FEE_TAX_ROUNDING_MODE = "ROUND_HALF_UP" as const;

export class InvalidLeadFeeTaxBaseError extends Error {
  constructor() {
    super("Lead fee tax base must be a positive plain decimal amount with at most 2 fraction digits.");
    this.name = "InvalidLeadFeeTaxBaseError";
  }
}

export interface LeadFeeTaxComputation {
  /** Net lead fee, the taxable base (normalised, 2 decimals). */
  netAmount: string;
  /** IVA rate in basis points (2100 = 21%). */
  taxRateBps: number;
  /** round(net × rate, 2), 2 decimals. */
  taxAmount: string;
  /** net + tax, 2 decimals: what the professional pays MaestroYa. */
  totalAmount: string;
  taxPolicyVersion: typeof LEAD_FEE_TAX_POLICY_VERSION;
}

/**
 * Computes IVA on a NET lead fee given as an exact decimal string (the M135
 * purchase price). Throws InvalidLeadFeeTaxBaseError for anything that is not a
 * positive plain decimal with <= 2 fraction digits.
 */
export function computeLeadFeeTax(netAmount: unknown): LeadFeeTaxComputation {
  const netCents = parseScaledDecimal(netAmount, 2);
  if (netCents === null || netCents <= 0n) throw new InvalidLeadFeeTaxBaseError();
  const taxCents = (netCents * LEAD_FEE_IVA_RATE_BPS + BPS_DENOMINATOR / 2n) / BPS_DENOMINATOR;
  return {
    netAmount: formatScaledDecimal(netCents, 2, 2),
    taxRateBps: Number(LEAD_FEE_IVA_RATE_BPS),
    taxAmount: formatScaledDecimal(taxCents, 2, 2),
    totalAmount: formatScaledDecimal(netCents + taxCents, 2, 2),
    taxPolicyVersion: LEAD_FEE_TAX_POLICY_VERSION,
  };
}
