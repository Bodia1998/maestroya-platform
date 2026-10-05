/**
 * Fixed-point decimal helpers shared by deterministic money engines
 * (Module 128 Lead pricing, Module 129 Job Value Estimation).
 *
 * Amounts are parsed from plain decimal strings into scaled bigint integers;
 * no JavaScript floating point is involved anywhere.
 */
const MAX_INTEGER_DIGITS = 12;

/** Parses a plain non-negative decimal string into an integer scaled by 10^scale. Anything else -> null. */
export function parseScaledDecimal(input: unknown, scale: number): bigint | null {
  if (typeof input !== "string") return null;
  const m = /^(\d{1,12})(?:\.(\d+))?$/.exec(input);
  const integerPart = m?.[1];
  if (!m || !integerPart || integerPart.length > MAX_INTEGER_DIGITS) return null;
  const fraction = m[2] ?? "";
  if (fraction.length > scale) return null;
  return BigInt(integerPart + fraction.padEnd(scale, "0"));
}

/** Formats a scaled integer. `minFraction` trailing zeros are kept (2 for money). */
export function formatScaledDecimal(value: bigint, scale: number, minFraction: number): string {
  const divisor = 10n ** BigInt(scale);
  const whole = value / divisor;
  let fraction = (value % divisor).toString().padStart(scale, "0");
  while (fraction.length > minFraction && fraction.endsWith("0")) fraction = fraction.slice(0, -1);
  return fraction === "" ? whole.toString() : `${whole}.${fraction}`;
}
