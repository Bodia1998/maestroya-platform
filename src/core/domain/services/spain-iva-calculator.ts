import { InvalidTaxRateError } from "@/domain/errors/domain-error";
import {
  assertValidTaxableAmount,
  roundTaxAmount,
  type TaxCalculationInput,
  type TaxCalculationResult,
  type TaxCalculator,
} from "@/domain/services/tax-calculator";

/**
 * Module 36 — Tax Engine Preparation: Spain's IVA (Impuesto sobre el Valor
 * Añadido) implementation of the country-agnostic `TaxCalculator`
 * contract. This is the *first* country supported by the Tax Engine, not
 * the *only* one the engine can support — see `tax-calculator.ts` for the
 * interface every future country implements the same way, and
 * `tax-engine.ts` for how this calculator plugs into the registry.
 *
 * Spain applies four official IVA rates (Ley 37/1992 and subsequent
 * royal decrees): a 21% general rate (most goods/services, including the
 * kind of home-services labor MaestroYa's commission engine already
 * models), a 10% reduced rate, a 4% super-reduced rate, and a 0% exempt
 * rate for specific exempt supplies. This calculator only encodes those
 * four rates and which one applies by default — it does not decide, on
 * MaestroYa's behalf, which category a given service falls into; a caller
 * (e.g. a future admin-configurable per-category rate) passes the
 * intended rate explicitly via `TaxCalculationInput.rateBps`, or omits it
 * to get the general rate, which is the correct default for the general
 * home-services categories MaestroYa currently supports.
 */

/** Spain's four official IVA rates, in basis points. 2100 = 21%. */
export const SPAIN_IVA_RATES_BPS = {
  /** 21% — the general rate; the correct default for most services. */
  GENERAL: 2100,
  /** 10% — reduced rate (e.g. certain renovation/repair services on
   *  private dwellings under specific conditions). */
  REDUCED: 1000,
  /** 4% — super-reduced rate (e.g. certain first-necessity goods). */
  SUPER_REDUCED: 400,
  /** 0% — exempt supplies. */
  EXEMPT: 0,
} as const;

const VALID_SPAIN_IVA_RATES_BPS: ReadonlySet<number> = new Set(
  Object.values(SPAIN_IVA_RATES_BPS),
);

export class SpainIvaCalculator implements TaxCalculator {
  readonly countryCode = "ES";

  calculate(input: TaxCalculationInput): TaxCalculationResult {
    assertValidTaxableAmount(input.taxableAmount);

    const rateBps = input.rateBps ?? SPAIN_IVA_RATES_BPS.GENERAL;
    if (!VALID_SPAIN_IVA_RATES_BPS.has(rateBps)) {
      throw new InvalidTaxRateError(
        rateBps,
        Array.from(VALID_SPAIN_IVA_RATES_BPS),
        this.countryCode,
      );
    }

    const taxableAmount = roundTaxAmount(input.taxableAmount);
    const taxAmount = roundTaxAmount((taxableAmount * rateBps) / 10000);

    return {
      countryCode: this.countryCode,
      rateBps,
      taxAmount,
    };
  }
}

/** Singleton instance — Spain's IVA rules have no per-request state, so
 *  (like `DEFAULT_COMMISSION_RATES`'s companion functions) one shared
 *  instance is all any caller needs. Registered into
 *  `DEFAULT_TAX_CALCULATORS` in `tax-engine.ts`. */
export const SPAIN_IVA_CALCULATOR = new SpainIvaCalculator();
