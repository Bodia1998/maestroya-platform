import type {
  AiVisibilityObservationRecord,
  AiVisibilityObservationRepository,
  AiVisibilityProviderKind,
  AiVisibilityRecommendationClassificationValue,
} from "@/domain/repositories/ai-visibility-observation-repository";
import { findAiVisibilityQueryById, type AiVisibilityQueryIntent } from "@/shared/content/ai-visibility-queries";

/**
 * Module 119 — AI Recommendation Monitoring, Phase 9 (Reporting).
 *
 * Every rate below is a plain `{ numerator, denominator }` pair, never a
 * single blended "AI visibility score" — Phase 9's own instruction: "Do
 * not create a single arbitrary 'AI visibility score'... Each metric must
 * clearly state numerator/denominator and the observation period."
 * `recommendationClassificationCounts` is a per-bucket count, never a
 * weighted average — Phase 3/9's own warning against treating AI output
 * as a stable ranking position.
 *
 * Deliberately excludes `neutral: true` queries (see
 * `ai-visibility-queries.ts`) from every rate's denominator by default —
 * folding a query that is EXPECTED to not mention MaestroYa into the same
 * denominator as a marketplace-relevant query would understate the real
 * mention rate and misrepresent what "0% on this query" means. Neutral-
 * query observations are still fully preserved and reported on
 * separately (`neutralQueryMentionRate`), never discarded.
 */

export interface AiVisibilityRate {
  numerator: number;
  denominator: number;
}

function rate(numerator: number, denominator: number): AiVisibilityRate {
  return { numerator, denominator };
}

export interface AiVisibilityMetricsPeriod {
  from: Date | null;
  to: Date | null;
}

export interface AiVisibilityBreakdownEntry {
  key: string;
  totalObservations: number;
  mentionRate: AiVisibilityRate;
}

export interface AiVisibilityMetricsReport {
  period: AiVisibilityMetricsPeriod;
  /** Total observations in the period, across every query (including
   *  neutral ones) — the raw count, not itself a rate. */
  totalObservations: number;
  /** How often MaestroYa was mentioned at all, among non-neutral-query
   *  observations. */
  mentionRate: AiVisibilityRate;
  /** How often MaestroYa was mentioned at all, among neutral-query
   *  observations — expected to be low; a rising trend here is worth a
   *  human look, not itself an error. */
  neutralQueryMentionRate: AiVisibilityRate;
  /** Among observations where MaestroYa was mentioned: how often a
   *  citation/source was present at all. */
  citationRate: AiVisibilityRate;
  /** Among citations that were present: how often they pointed to a
   *  legitimate MaestroYa source. */
  citationCorrectnessRate: AiVisibilityRate;
  /** Among mentioned observations where identity accuracy is
   *  applicable: how often it was judged CORRECT. */
  correctIdentityRate: AiVisibilityRate;
  /** Among mentioned observations where geographic accuracy is
   *  applicable: how often it was judged CORRECT. */
  correctGeographicRate: AiVisibilityRate;
  /** Among mentioned observations where service accuracy is applicable:
   *  how often it was judged CORRECT. */
  correctServiceRate: AiVisibilityRate;
  /** Among mentioned observations: how often the official URL was
   *  provided at all (CORRECT or INCORRECT, i.e. not NOT_PROVIDED). */
  urlProvidedRate: AiVisibilityRate;
  /** Among mentioned observations where a URL was provided at all: how
   *  often it was the correct, official URL. */
  correctUrlRate: AiVisibilityRate;
  /** Per-bucket counts — never averaged, never treated as a score (see
   *  this file's own doc comment). */
  recommendationClassificationCounts: Record<AiVisibilityRecommendationClassificationValue, number>;
  /** Mention rate broken down by the query's declared intent category
   *  (Phase 9: "In which query categories?"). */
  byQueryIntent: AiVisibilityBreakdownEntry[];
  /** Mention rate broken down by the query's declared service, for
   *  service-specific/geographic queries that name one (Phase 9: "Which
   *  services were correctly understood?" — paired with
   *  `correctServiceRate` above for the accuracy half of that
   *  question). */
  byService: AiVisibilityBreakdownEntry[];
  /** Mention rate broken down by AI provider/system tested (Phase 9:
   *  "Which AI providers/models were tested?"). */
  byProvider: AiVisibilityBreakdownEntry[];
  /** Every distinct competitor name recorded across the period, with a
   *  plain observation count — never a ranking (Phase 8's own rule). */
  competitorMentionCounts: { name: string; count: number }[];
  /** Every distinct factual-issue note recorded across the period, for
   *  a human to review — deliberately not deduplicated by fuzzy
   *  similarity (that would be an unreviewed judgment call this module
   *  does not make); exact-string duplicates are still collapsed with a
   *  count. */
  factualIssueCounts: { issue: string; count: number }[];
}

const RECOMMENDATION_CLASSIFICATION_VALUES: AiVisibilityRecommendationClassificationValue[] = [
  "NOT_MENTIONED",
  "MENTIONED_ONLY",
  "LISTED_AMONG_OPTIONS",
  "RECOMMENDED",
];

function emptyClassificationCounts(): Record<AiVisibilityRecommendationClassificationValue, number> {
  return {
    NOT_MENTIONED: 0,
    MENTIONED_ONLY: 0,
    LISTED_AMONG_OPTIONS: 0,
    RECOMMENDED: 0,
  };
}

function breakdownByKey(observations: AiVisibilityObservationRecord[], keyOf: (o: AiVisibilityObservationRecord) => string | null): AiVisibilityBreakdownEntry[] {
  const buckets = new Map<string, AiVisibilityObservationRecord[]>();
  for (const observation of observations) {
    const key = keyOf(observation);
    if (key === null) continue;
    const bucket = buckets.get(key) ?? [];
    bucket.push(observation);
    buckets.set(key, bucket);
  }
  return Array.from(buckets.entries())
    .map(([key, bucket]) => ({
      key,
      totalObservations: bucket.length,
      mentionRate: rate(bucket.filter((o) => o.mentioned).length, bucket.length),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

export class GetAiVisibilityMetricsUseCase {
  constructor(private readonly observations: AiVisibilityObservationRepository) {}

  async execute(period: AiVisibilityMetricsPeriod): Promise<AiVisibilityMetricsReport> {
    const all = await this.observations.listForPeriod(period);

    const neutral: AiVisibilityObservationRecord[] = [];
    const nonNeutral: AiVisibilityObservationRecord[] = [];
    for (const observation of all) {
      const query = findAiVisibilityQueryById(observation.queryId);
      (query?.neutral ? neutral : nonNeutral).push(observation);
    }

    const mentioned = nonNeutral.filter((o) => o.mentioned);
    const citedAmongMentioned = mentioned.filter((o) => o.citationPresent);
    const identityApplicable = mentioned.filter((o) => o.identityAccuracy !== "NOT_APPLICABLE");
    const geoApplicable = mentioned.filter((o) => o.geographicAccuracy !== "NOT_APPLICABLE");
    const serviceApplicable = mentioned.filter((o) => o.serviceAccuracy !== "NOT_APPLICABLE");
    const urlProvided = mentioned.filter((o) => o.urlAccuracy !== "NOT_PROVIDED");

    const classificationCounts = emptyClassificationCounts();
    for (const observation of nonNeutral) {
      classificationCounts[observation.recommendationClassification] += 1;
    }
    // Guard: every value in RECOMMENDATION_CLASSIFICATION_VALUES has a
    // key in the record above — iterating it here (rather than trusting
    // the object literal alone) keeps this in sync if the union type
    // ever grows without a corresponding count added.
    for (const value of RECOMMENDATION_CLASSIFICATION_VALUES) {
      if (!(value in classificationCounts)) classificationCounts[value] = 0;
    }

    const competitorCounts = new Map<string, number>();
    const factualIssueCounts = new Map<string, number>();
    for (const observation of all) {
      for (const name of observation.detectedCompetitors) {
        competitorCounts.set(name, (competitorCounts.get(name) ?? 0) + 1);
      }
      for (const issue of observation.factualIssues) {
        factualIssueCounts.set(issue, (factualIssueCounts.get(issue) ?? 0) + 1);
      }
    }

    return {
      period,
      totalObservations: all.length,
      mentionRate: rate(mentioned.length, nonNeutral.length),
      neutralQueryMentionRate: rate(neutral.filter((o) => o.mentioned).length, neutral.length),
      citationRate: rate(citedAmongMentioned.length, mentioned.length),
      citationCorrectnessRate: rate(citedAmongMentioned.filter((o) => o.citationCorrect === true).length, citedAmongMentioned.length),
      correctIdentityRate: rate(identityApplicable.filter((o) => o.identityAccuracy === "CORRECT").length, identityApplicable.length),
      correctGeographicRate: rate(geoApplicable.filter((o) => o.geographicAccuracy === "CORRECT").length, geoApplicable.length),
      correctServiceRate: rate(serviceApplicable.filter((o) => o.serviceAccuracy === "CORRECT").length, serviceApplicable.length),
      urlProvidedRate: rate(urlProvided.length, mentioned.length),
      correctUrlRate: rate(urlProvided.filter((o) => o.urlAccuracy === "CORRECT").length, urlProvided.length),
      recommendationClassificationCounts: classificationCounts,
      byQueryIntent: breakdownByKey(nonNeutral, (o) => (findAiVisibilityQueryById(o.queryId)?.intent as AiVisibilityQueryIntent | undefined) ?? null),
      byService: breakdownByKey(nonNeutral, (o) => findAiVisibilityQueryById(o.queryId)?.service ?? null),
      byProvider: breakdownByKey(nonNeutral, (o) => o.provider as AiVisibilityProviderKind),
      competitorMentionCounts: Array.from(competitorCounts.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
      factualIssueCounts: Array.from(factualIssueCounts.entries())
        .map(([issue, count]) => ({ issue, count }))
        .sort((a, b) => b.count - a.count || a.issue.localeCompare(b.issue)),
    };
  }
}
