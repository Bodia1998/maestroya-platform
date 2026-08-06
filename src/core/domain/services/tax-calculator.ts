import { TaxCalculationError, UnsupportedCountryError } from "@/domain/errors/domain-error";
import { roundToCents } from "@/domain/services/money";

/**
 * Module 36 — Tax Engine Preparation: the country-agnostic tax contract.
 *
 * This file deliberately contains zero country-specific logic — no IVA, no
 * VAT, no rate numbers. It only defines the shape every country's tax
 * calculator must implement (`TaxCalculator`) and a small registry so the
 * domain layer can resolve "the calculator for country X" without a
 * switch/if-chain that would need editing every time a new country is
 * added. See `spain-iva-calculator.ts` for the first (and, as of this
 * module, only) implementation, and `tax-engine.ts` for how a calculator is
 * combined with the existing commission engine to produce a full
 * `PriceBreakdown`.
 *
 * Deliberately NOT here: invoicing, Stripe/payment-gateway integration,
 * external tax-provider calls (e.g. AEAT), or Prisma/infrastructure code —
 * this module (and everything in `domain/services/tax-*`) is pure
 * calculation only, per the Module 36 spec's explicit boundary.
 *
 * Money convention matches `money.ts`/`commission-policy.ts`: plain
 * `number`s, rounded to whole cents via `roundToCents` at every arithmetic
 * step, no decimal library.
 */

/** A tax calculation request. `rateBps` is optional — when omitted, the
 *  resolved `TaxCalculator` picks its own default rate (see
 *  `SpainIvaCalculator`, which defaults to the general 21% rate). Passing
 *  it lets a caller select a country's non-default rate (e.g. Spain's
 *  reduced or super-reduced IVA rates) without the domain needing a
 *  country-specific "rate category" concept at this layer. */
export interface TaxCalculationInput {
  /** The amount tax is charged on. Never negative. */
  taxableAmount: number;
  /** Basis points (bps); 2100 = 21%. Must be a rate the resolved
   *  calculator recognizes for its own country — see that calculator's own
   *  validation (e.g. `SpainIvaCalculator` only accepts Spain's four
   *  official IVA rates). */
  rateBps?: number;
}

/** The result of a single tax calculation. Carries `countryCode` and
 *  `rateBps` alongside the amount so a caller (or a persisted record) can
 *  always tell which country/rate produced a given `taxAmount` without
 *  needing to re-derive it. */
export interface TaxCalculationResult {
  countryCode: string;
  rateBps: number;
  taxAmount: number;
}

/**
 * The contract every country's tax calculator implements. Kept
 * deliberately minimal (one method) so adding a new country never requires
 * touching this file or any existing country's implementation — only a new
 * file implementing this interface, plus one line registering it (see
 * `tax-engine.ts`'s `DEFAULT_TAX_CALCULATORS`).
 */
export interface TaxCalculator {
  /** ISO 3166-1 alpha-2 country code this calculator applies to, e.g.
   *  `"ES"` for Spain. */
  readonly countryCode: string;
  calculate(input: TaxCalculationInput): TaxCalculationResult;
}

/** Shared validation every `TaxCalculator` implementation should run
 *  against `taxableAmount` before doing its own country-specific
 *  validation (e.g. rate checks). Exported so each country's calculator
 *  doesn't re-derive this check. */
export function assertValidTaxableAmount(value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new TaxCalculationError("taxableAmount must be a non-negative finite number.");
  }
}

/** Rounds a tax calculation's amount to whole cents — thin wrapper over
 *  `roundToCents` kept here so country calculators import tax-specific
 *  rounding from one place rather than reaching into `money.ts` directly;
 *  today it's the same function, but this indirection is what would let a
 *  future country apply different rounding rules (e.g. rounding direction
 *  required by a specific tax authority) without changing this file's
 *  interface. */
export function roundTaxAmount(amount: number): number {
  return roundToCents(amount);
}

/** A read-only map of country code -> `TaxCalculator`. Read-only because
 *  resolving a calculator must never have the side effect of mutating the
 *  registry — building/extending a registry is always an explicit,
 *  separate step (see `tax-engine.ts`'s `DEFAULT_TAX_CALCULATORS`). */
export type TaxCalculatorRegistry = ReadonlyMap<string, TaxCalculator>;

/** Normalizes a country code for registry lookup: trims whitespace and
 *  upper-cases it, so `"es"`, `"Es"`, and `"ES"` all resolve to the same
 *  registered calculator. This is the *only* place country-code
 *  normalization happens — callers and `TaxCalculator` implementations
 *  never need to normalize a country code themselves, and registry keys
 *  (e.g. `SpainIvaCalculator.countryCode`) are expected to already be
 *  canonical (upper-case ISO 3166-1 alpha-2) so this function's output
 *  matches them directly. */
function normalizeCountryCode(countryCode: string): string {
  return countryCode.trim().toUpperCase();
}

/**
 * Resolves the `TaxCalculator` for a country code out of a registry.
 * Throws rather than silently falling back to any default — an unsupported
 * country must be a caller-visible error, never a silently-wrong tax rate.
 */
export function resolveTaxCalculator(
  countryCode: string,
  registry: TaxCalculatorRegistry,
): TaxCalculator {
  const normalized = normalizeCountryCode(countryCode);
  const calculator = registry.get(normalized);
  if (!calculator) {
    throw new UnsupportedCountryError(normalized);
  }
  return calculator;
}
