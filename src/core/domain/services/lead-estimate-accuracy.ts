import { createHash } from "node:crypto";

import { parseScaledDecimal } from "@/domain/services/fixed-point-decimal";

/**
 * Module 164 — ESTIMATE-ACCURACY EVALUATION. Pure and deterministic; no I/O, no clock, no randomness.
 *
 * Purpose. The business TARGET is: "at least 90% of automatically accepted estimates fall within a defined tolerance of the
 * eventual actual job value". That is a hypothesis to TEST, never a number to hard-code or claim. This file is the method for
 * testing it once real outcomes exist. It does not contain, and must never be seeded with, invented outcomes.
 *
 * Method (documented in docs/MODULE_164_REGIONAL_CALIBRATED_PRICING.md):
 *   - Observation = one lead's estimate (the published "average estimated job value") and the ACTUAL job value a person recorded.
 *   - Criterion = relative error |estimate - actual| / actual <= tolerance. The tolerance is a PARAMETER. The owner has NOT
 *     approved one; +-20% is only a candidate used to illustrate the report.
 *   - Leakage resistance. Whatever is used to set or tune calibration parameters must never be used to evaluate them. A
 *     deterministic hash split (`isHoldout`) assigns each lead id to TUNING or HOLDOUT from a seed, so the split is stable across
 *     runs and cannot be steered by looking at outcomes; `assertNoLeakage` refuses an evaluation set that overlaps the tuning set.
 *   - Honest reporting. The rate is reported with a Wilson lower confidence bound (z = 1.96) and only counts as meeting the target
 *     when the LOWER bound reaches it on an adequate sample. Results are broken down by category, province, price band,
 *     confidence band, questionnaire version and calibration version. An aggregate that meets the target while a sufficiently
 *     large stratum does not, or while strata are too small to judge, is reported as aggregate-only — never as success.
 *
 * Money comparisons are exact (bigint cents and 6-digit fixed-point tolerance). The Wilson bound is a statistic, not money, and
 * uses floating point only for the bound itself.
 */

export interface EstimateObservation {
  /** Stable id (the lead id). */
  id: string;
  /** Published average estimated job value, EUR decimal string. */
  estimate: string;
  /** Recorded actual job value, EUR decimal string. */
  actual: string;
  categorySlug: string;
  provinceCode: string | null;
  confidenceBand: string | null;
  questionnaireVersion: string | null;
  calibrationVersion: string;
}

export interface AccuracyEvaluationOptions {
  /** Relative tolerance, e.g. "0.20". A parameter: not an approved business decision. */
  toleranceRelative: string;
  /** The rate to be demonstrated, e.g. "0.90". */
  targetRate: string;
  /** A stratum smaller than this is reported but never judged. */
  minimumSample: number;
  /** Upper edges (EUR cents) of the price bands; default 100, 300, 1000 EUR. */
  priceBandEdgesCents?: readonly number[];
}

export interface AccuracyStat {
  n: number;
  within: number;
  /** within / n, 4 decimals, e.g. "0.9100". "0.0000" when n = 0. */
  rate: string;
  /** Wilson 95% lower bound of the rate, 4 decimals. */
  wilsonLower: string;
  sufficient: boolean;
  /** null when the sample is insufficient (not judged). */
  meetsTarget: boolean | null;
}

export const ACCURACY_DIMENSIONS = ["category", "province", "priceBand", "confidenceBand", "questionnaireVersion", "calibrationVersion"] as const;
export type AccuracyDimension = (typeof ACCURACY_DIMENSIONS)[number];

export type AccuracyVerdict =
  | "NO_DATA"
  | "INSUFFICIENT_SAMPLE"
  | "TARGET_NOT_MET"
  /** The aggregate reaches the target but a judged stratum fails, or some strata are too small to judge: NOT a success claim. */
  | "AGGREGATE_ONLY"
  | "TARGET_MET";

export interface AccuracyReport {
  toleranceRelative: string;
  targetRate: string;
  minimumSample: number;
  invalidObservations: number;
  overall: AccuracyStat;
  strata: Readonly<Record<AccuracyDimension, Readonly<Record<string, AccuracyStat>>>>;
  verdict: AccuracyVerdict;
}

const FIXED_ONE = 1_000_000n;
const Z = 1.96;
const DEFAULT_BAND_EDGES_CENTS = [10_000, 30_000, 100_000] as const;

/** |estimate - actual| / actual <= tolerance, exactly. Invalid money -> null. */
export function isWithinTolerance(estimate: unknown, actual: unknown, toleranceRelative: string): boolean | null {
  const e = parseScaledDecimal(estimate, 2);
  const a = parseScaledDecimal(actual, 2);
  const t = parseScaledDecimal(toleranceRelative, 6);
  if (e === null || a === null || t === null || a <= 0n || t === 0n) return null;
  const diff = e > a ? e - a : a - e;
  return diff * FIXED_ONE <= t * a;
}

/** Deterministic, outcome-independent hold-out assignment from a seed. `holdoutPercent` in 1..99. */
export function isHoldout(id: string, seed: string, holdoutPercent: number): boolean {
  if (!Number.isInteger(holdoutPercent) || holdoutPercent < 1 || holdoutPercent > 99) throw new RangeError("holdoutPercent must be an integer in 1..99");
  const digest = createHash("sha256").update(`${seed}:${id}`).digest();
  return digest.readUInt32BE(0) % 100 < holdoutPercent;
}

export function splitObservations<T extends { id: string }>(observations: readonly T[], seed: string, holdoutPercent: number): { tuning: T[]; holdout: T[] } {
  const tuning: T[] = [];
  const holdout: T[] = [];
  for (const o of observations) (isHoldout(o.id, seed, holdoutPercent) ? holdout : tuning).push(o);
  return { tuning, holdout };
}

/** Throws if any evaluated id was also used to tune parameters. */
export function assertNoLeakage(tuningIds: Iterable<string>, evaluationIds: Iterable<string>): void {
  const tuned = new Set(tuningIds);
  for (const id of evaluationIds) {
    if (tuned.has(id)) throw new Error("Evaluation set overlaps the tuning set (leakage).");
  }
}

function ratio4(numerator: number, denominator: number): string {
  if (denominator === 0) return "0.0000";
  const scaled = Math.floor((numerator * 10_000) / denominator);
  return scaled >= 10_000 ? "1.0000" : `0.${String(scaled).padStart(4, "0")}`;
}

function wilsonLower(within: number, n: number): number {
  if (n === 0) return 0;
  const p = within / n;
  const z2 = Z * Z;
  const centre = p + z2 / (2 * n);
  const margin = Z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return Math.max(0, (centre - margin) / (1 + z2 / n));
}

function fmt4(x: number): string {
  const scaled = Math.min(10_000, Math.max(0, Math.floor(x * 10_000)));
  return scaled === 10_000 ? "1.0000" : `0.${String(scaled).padStart(4, "0")}`;
}

function toStat(within: number, n: number, minimumSample: number, target: number): AccuracyStat {
  const lower = wilsonLower(within, n);
  const sufficient = n >= minimumSample;
  return {
    n,
    within,
    rate: ratio4(within, n),
    wilsonLower: fmt4(lower),
    sufficient,
    meetsTarget: sufficient ? lower >= target : null,
  };
}

function priceBand(actualCents: bigint, edges: readonly number[]): string {
  let lowerEdge = 0;
  for (const edge of edges) {
    if (actualCents < BigInt(edge)) return `${lowerEdge / 100}-${edge / 100}`;
    lowerEdge = edge;
  }
  return `${lowerEdge / 100}+`;
}

/**
 * Evaluates ONLY the observations given (callers pass the HOLDOUT set). Observations with unparsable money are counted in
 * `invalidObservations` and excluded — never repaired and never counted as hits.
 */
export function evaluateEstimateAccuracy(observations: readonly EstimateObservation[], options: AccuracyEvaluationOptions): AccuracyReport {
  const targetFixed = parseScaledDecimal(options.targetRate, 6);
  if (targetFixed === null || targetFixed === 0n || targetFixed > FIXED_ONE) throw new RangeError("targetRate must be a decimal in (0, 1]");
  if (parseScaledDecimal(options.toleranceRelative, 6) === null || parseScaledDecimal(options.toleranceRelative, 6) === 0n) throw new RangeError("toleranceRelative must be a positive decimal");
  if (!Number.isInteger(options.minimumSample) || options.minimumSample < 1) throw new RangeError("minimumSample must be a positive integer");
  const target = Number(targetFixed) / 1_000_000;
  const edges = options.priceBandEdgesCents ?? DEFAULT_BAND_EDGES_CENTS;

  const tallies = new Map<string, { n: number; within: number }>();
  const bump = (key: string, hit: boolean) => {
    const t = tallies.get(key) ?? { n: 0, within: 0 };
    t.n += 1;
    if (hit) t.within += 1;
    tallies.set(key, t);
  };

  let invalid = 0;
  for (const o of observations) {
    const hit = isWithinTolerance(o.estimate, o.actual, options.toleranceRelative);
    const actualCents = parseScaledDecimal(o.actual, 2);
    if (hit === null || actualCents === null) {
      invalid += 1;
      continue;
    }
    bump("overall", hit);
    bump(`category|${o.categorySlug}`, hit);
    bump(`province|${o.provinceCode ?? "unknown"}`, hit);
    bump(`priceBand|${priceBand(actualCents, edges)}`, hit);
    bump(`confidenceBand|${o.confidenceBand ?? "unknown"}`, hit);
    bump(`questionnaireVersion|${o.questionnaireVersion ?? "none"}`, hit);
    bump(`calibrationVersion|${o.calibrationVersion}`, hit);
  }

  const stat = (key: string) => {
    const t = tallies.get(key) ?? { n: 0, within: 0 };
    return toStat(t.within, t.n, options.minimumSample, target);
  };
  const strata = {} as Record<AccuracyDimension, Record<string, AccuracyStat>>;
  for (const dimension of ACCURACY_DIMENSIONS) {
    const bucket: Record<string, AccuracyStat> = {};
    for (const key of [...tallies.keys()].filter((k) => k.startsWith(`${dimension}|`)).sort()) bucket[key.slice(dimension.length + 1)] = stat(key);
    strata[dimension] = bucket;
  }

  const overall = stat("overall");
  const all = ACCURACY_DIMENSIONS.flatMap((d) => Object.values(strata[d]));
  let verdict: AccuracyVerdict;
  if (overall.n === 0) verdict = "NO_DATA";
  else if (!overall.sufficient) verdict = "INSUFFICIENT_SAMPLE";
  else if (overall.meetsTarget === false) verdict = "TARGET_NOT_MET";
  else if (all.some((s) => !s.sufficient || s.meetsTarget === false)) verdict = "AGGREGATE_ONLY";
  else verdict = "TARGET_MET";

  return {
    toleranceRelative: options.toleranceRelative,
    targetRate: options.targetRate,
    minimumSample: options.minimumSample,
    invalidObservations: invalid,
    overall,
    strata,
    verdict,
  };
}
