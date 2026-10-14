# Module 164 — Regional & Calibrated Pricing

Status: implemented behind `LEAD_REGIONAL_PRICING_MODE` (default `OFF`). **Ships with no enabled region/category combination.** Not production-ready: see "Launch blockers".

## Decisions applied
- **D1** Paid-lead territory: mainland Spain + Balearic Islands. Canarias (35, 38), Ceuta (51), Melilla (52) are unsupported — enforced in the domain, the configuration contract and the database (`lead_pricing_reviews_territory_check`).
- **D3** Lead price = 10% of the average estimated job value, optionally × a bounded supply multiplier, clamped to EUR 20.00–400.00 excluding IVA. Tax is not computed or hardcoded here. The supply multiplier is **DISABLED** (neutral 1.0): no approved bounds or computation rule exist.
- **D4** Confidence target >= 7/10 for automatic publication, but it is a heuristic evidence score, **not** an accuracy estimate.

## Three-way decision
AUTO_PRICE (score >= threshold and an APPROVED, evidenced calibration entry) · REVIEW_REQUIRED (administrator review) · UNPRICED (fail closed: unsupported territory/category/combination, unresolved region, invalid scope, value above ceiling, wrong flow).
No fallback between regions or categories; no invented defaults; deterministic; published/purchased leads are never repriced (snapshot trigger covers the new provenance column).

## Confidence (0–10, five components of 0–2)
SCOPE_ANSWERS, CATEGORY_MATCH, REGION_CALIBRATION, ESTIMATE_PRECISION, EMPIRICAL_VALIDATION. Empirical validation scores only from a recorded holdout validation that meets the sample/rate bar. Hence: max 8 without validation, HIGH requires validation, complete questionnaire answers alone never establish accuracy.

## Review path
Publication that needs review opens (idempotently) one `lead_pricing_reviews` row keyed by `(leadId, inputFingerprint)` (fingerprint = sha256 of canonical inputs incl. calibration version), tells the customer truthfully that it is under review (`LEAD_PRICING_UNDER_REVIEW`), and leaves the lead DRAFT. An admin supplies a job **value** (never a price); a decision is final; a changed input or calibration version yields a new fingerprint, so stale approvals cannot apply. Server actions exist (ADMIN/SUPER_ADMIN, re-checked in the use case); **no admin UI page yet**.

## Mode switch
`OFF` (default; M132/M163 path unchanged) · `SHADOW` (calibrated decision logged as labels only, never alters the outcome) · `ENFORCE` (calibrated path only, no legacy fallback). `LEAD_REGIONAL_PRICING_CALIBRATION_VERSION` selects the release; read per call; unset/unknown → unavailable → fail closed.

## Evaluating the 90% target
Method implemented in `lead-estimate-accuracy.ts`, data foundation in `lead_estimate_outcomes` (admin-recorded actual job values, immutable). Procedure: deterministic seeded holdout split (no leakage), tolerance on |estimate − actual| / actual in exact arithmetic, stratified by category, province, price band, confidence band, questionnaire version and calibration version, Wilson 95% lower bound, minimum sample per stratum. Verdicts: NO_DATA, INSUFFICIENT_SAMPLE, TARGET_NOT_MET, AGGREGATE_ONLY, TARGET_MET. **No outcomes exist, so the 90% target is NOT validated.** The +/-20% tolerance, 100-sample minimum and spread thresholds are engineering defaults awaiting owner approval.

## Unapproved assumptions / gaps
1. Any category x province job-value range (needs approved parameters + evidence).
2. Supply-multiplier policy (bounds, computation).
3. Tolerance, minimum sample, confidence spread thresholds.
4. Admin UI page and admin audit-log enum extension.
5. IVA presentation of the lead price (kept separate).
6. A runner script for the accuracy report.

## Rollback
Set `LEAD_REGIONAL_PRICING_MODE=OFF` (instant). Migration rollback notes are in the migration header.
