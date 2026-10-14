import type { JobValueEstimationContextReader } from "@/application/ports/job-value-estimation-context-reader";
import type { LeadPricingRegionReader } from "@/application/ports/lead-pricing-region-reader";
import type { LeadPublicationPriceSource } from "@/application/ports/lead-publication-price-source";
import type { LeadScopeEstimationSource } from "@/application/services/lead-pricing/estimated-value-lead-pricing-context-reader";
import type { LeadPricingReviewRepository } from "@/domain/repositories/lead-pricing-review-repository";
import { decideCalibratedLeadPrice, priceReviewedJobValue, type CalibratedScopeInput } from "@/domain/services/lead-calibrated-estimate";
import type { RegionalCalibrationResolution } from "@/domain/services/lead-regional-calibration";
import { computeReviewInputFingerprint } from "@/domain/services/lead-pricing-review";
import type { LeadPublicationPriceOutcome } from "@/domain/services/lead-publication";
import { deriveStructuredScope, findScopeQuestionnaire, type LeadScopeProvenance } from "@/domain/services/lead-scope-questionnaire";
import type { LeadPricingRegion } from "@/domain/services/spain-pricing-territory";

/**
 * Module 164 — LeadPublicationPriceSource for the regional / calibrated pipeline.
 *
 * It GATHERS inputs (estimation context, province, stored scope, any recorded review) and hands them to the pure decision in
 * domain/services/lead-calibrated-estimate.ts. It contains no pricing formula and no confidence rule. It performs NO writes:
 * opening a review is the publication use case's job, so a price source can be run (shadow mode, preview) without side effects.
 *
 * Outcome mapping:
 *   AUTO_PRICE        -> RESOLVED with the calibration provenance.
 *   REVIEW_REQUIRED   -> a recorded APPROVED review whose fingerprint matches the CURRENT inputs is priced by the same formula
 *                        (RESOLVED, provenance "ADMIN_REVIEW"); a matching REJECTED review is UNPRICEABLE; otherwise
 *                        REVIEW_REQUIRED (the use case opens or re-uses the pending review).
 *   UNPRICED          -> UNPRICEABLE with the stable reason.
 *
 * A review recorded for DIFFERENT inputs (the customer's scope, the province or the calibration version changed) has a different
 * fingerprint and is therefore never found: it can never publish a price for inputs the administrator did not see.
 *
 * Stored scope that is unusable (tampered, invalid, questionnaire version changed) fails closed (SCOPE_INVALID), exactly as the
 * Module 163 pipeline does — it is never treated as "no scope". Contradictory answers go to review.
 */
export class CalibratedLeadPublicationPriceSource implements LeadPublicationPriceSource {
  constructor(
    private readonly contexts: JobValueEstimationContextReader,
    private readonly regions: LeadPricingRegionReader,
    private readonly calibration: RegionalCalibrationResolution,
    private readonly reviews: Pick<LeadPricingReviewRepository, "findByLeadAndFingerprint">,
    private readonly scopeSource?: LeadScopeEstimationSource,
  ) {}

  async priceForLead(leadId: string): Promise<LeadPublicationPriceOutcome> {
    if (this.calibration.status !== "VALID") return { kind: "CONFIGURATION_UNAVAILABLE" };
    const config = this.calibration.config;

    const context = await this.contexts.findByLeadId(leadId);
    if (!context) {
      return {
        kind: "RESOLVED",
        configVersion: config.calibrationVersion,
        jobValueRuleVersion: config.jobValueRuleVersion,
        result: { status: "UNPRICED", reason: "LEAD_NOT_FOUND", ruleVersion: config.pricingRuleVersion },
      };
    }

    const region: LeadPricingRegion = (await this.regions.findByLeadId(leadId)) ?? { status: "UNKNOWN", reason: "NO_ADDRESS" };
    const { scope, provenance: scopeProvenance } = await this.resolveScope(leadId, context);

    const decision = decideCalibratedLeadPrice(
      { flowVersion: context.flowVersion, categorySlug: context.categorySlug, parentCategorySlug: context.parentCategorySlug, region, scope },
      config,
    );

    if (decision.decision === "UNPRICED") return { kind: "UNPRICEABLE", configVersion: config.calibrationVersion, reason: decision.reason };

    if (decision.decision === "AUTO_PRICE") {
      return {
        kind: "RESOLVED",
        configVersion: config.calibrationVersion,
        jobValueRuleVersion: config.jobValueRuleVersion,
        result: decision.priced,
        calibration: decision.provenance,
        ...(scopeProvenance ? { scope: scopeProvenance } : {}),
      };
    }

    // REVIEW_REQUIRED: region is necessarily RESOLVED here (the decision refuses everything else before reaching review).
    if (region.status !== "RESOLVED" || context.categorySlug === null) return { kind: "UNPRICEABLE", configVersion: config.calibrationVersion, reason: "REGION_UNRESOLVED" };
    const inputFingerprint = computeReviewInputFingerprint({
      leadId,
      categorySlug: context.categorySlug,
      parentCategorySlug: context.parentCategorySlug,
      provinceCode: region.provinceCode,
      scopeState: scope.status === "STRUCTURED" ? "STRUCTURED" : scope.status === "CONFLICTING" ? "CONFLICTING" : "NONE",
      scope: scopeProvenance,
      calibrationVersion: config.calibrationVersion,
    });

    const recorded = await this.reviews.findByLeadAndFingerprint(leadId, inputFingerprint);
    if (recorded?.status === "REJECTED") return { kind: "UNPRICEABLE", configVersion: config.calibrationVersion, reason: "REVIEW_REJECTED" };
    if (recorded?.status === "APPROVED" && recorded.reviewedJobValue !== null) {
      const reviewed = priceReviewedJobValue(
        {
          flowVersion: context.flowVersion,
          categorySlug: context.categorySlug,
          parentCategorySlug: context.parentCategorySlug,
          region,
          reviewedJobValue: recorded.reviewedJobValue,
          reviewId: recorded.id,
          reviewReasons: recorded.reasonCodes,
        },
        config,
      );
      if (reviewed.status !== "PRICED") return { kind: "UNPRICEABLE", configVersion: config.calibrationVersion, reason: reviewed.reason };
      return {
        kind: "RESOLVED",
        configVersion: config.calibrationVersion,
        jobValueRuleVersion: config.jobValueRuleVersion,
        result: reviewed.priced,
        calibration: reviewed.provenance,
        ...(scopeProvenance ? { scope: scopeProvenance } : {}),
      };
    }

    return {
      kind: "REVIEW_REQUIRED",
      configVersion: config.calibrationVersion,
      reasons: decision.reasons,
      inputFingerprint,
      categorySlug: context.categorySlug,
      parentCategorySlug: context.parentCategorySlug,
      provinceCode: region.provinceCode,
      provenance: decision.provenance,
    };
  }

  /** Re-derives the stored scope against the CURRENT questionnaire definition (never trusts storage). */
  private async resolveScope(
    leadId: string,
    context: { flowVersion: string | null | undefined; categorySlug: string | null; parentCategorySlug: string | null },
  ): Promise<{ scope: CalibratedScopeInput; provenance: LeadScopeProvenance | null }> {
    if (!this.scopeSource) return { scope: { status: "NONE", questionnaireConfigured: false }, provenance: null };
    const registry = this.scopeSource.registry;
    const stored = await this.scopeSource.reader.findByLeadId(leadId);
    if (!stored) {
      const configured = findScopeQuestionnaire(registry, context.categorySlug, context.parentCategorySlug) !== null;
      return { scope: { status: "NONE", questionnaireConfigured: configured }, provenance: null };
    }
    const derivation = deriveStructuredScope(registry, context, stored.answers);
    if (derivation.status === "STRUCTURED" && derivation.structuredScope.questionnaireVersion === stored.questionnaireVersion) {
      const provenance: LeadScopeProvenance = { questionnaireVersion: stored.questionnaireVersion, answers: derivation.answers };
      return {
        scope: {
          status: "STRUCTURED",
          provenance,
          scopeFactor: derivation.structuredScope.scopeFactor,
          complexityFactor: derivation.structuredScope.complexityFactor,
        },
        provenance,
      };
    }
    // Contradictory answers (and nothing else wrong) need a human; every other unusable shape is tampered/invalid -> fail closed.
    if (derivation.status === "REJECTED" && derivation.issues.length > 0 && derivation.issues.every((i) => i.code === "CONTRADICTORY_ANSWERS")) {
      return { scope: { status: "CONFLICTING" }, provenance: null };
    }
    return { scope: { status: "INVALID" }, provenance: null };
  }
}
