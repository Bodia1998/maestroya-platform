# Module 162 — Affiliate Lead-Fee Reward Model

Status: **PARTIAL — blocked by D18.** Only the policy-independent, fail-closed domain foundation is implemented. **No reward can be created, no schema changed, no event subscribed, no payout enabled.** This document makes no legal-compliance or production-readiness claim.

## 1. Why this is partial

The roadmap (LEAD_V1 Roadmap v2, M162) marks the module `BLOCKED (D18)`. D18 = reward rate and basis, who is referred, hold period, minimum payout, tax treatment of partner payouts. The roadmap lists only a *recommended default* ("% of lead-fee net after Stripe fee, 30-day hold, reversible"), with no percentage. No approval is recorded in `docs/`, code or tests. The legacy 10 % (`AFFILIATE_COMMISSION_RATE_BPS`) applies to the legacy platform `Commission` and is deliberately **not** reused. Rate, hold, threshold, window and referred party are therefore not invented anywhere in the shipped code.

## 2. Reconnaissance summary (inspected, not assumed)

* **Branch/tree at start:** `feature/module-162/affiliate-lead-fee-reward-model` at `0dcbae1` (merge of M161, PR #172; M161 is an ancestor of HEAD). Working tree: only untracked `Claude outputs/`, `legal/`, `docs/MODULE_130_STALE_LEAD_BACKFILL.sql` (protected).
* **Attribution:** `ReferralCode` (owner = partner user) → `ReferralVisit` → `MarketingAttribution` (visitor-keyed; write-once first touch, overwritten last touch; `userId` set at registration via `findByUserId`) → `ConversionEvent` (`@@unique[type, referenceId]`) → `AffiliateCommission` (`conversionEventId @unique`) with append-only `AffiliateCommissionReversal` (`financialAdjustmentId @unique`) → `PartnerPayout` (partial unique in-flight index). Fraud rules in `affiliate-fraud-rules.ts`; hard self-referral block in `RecordAffiliateCommissionUseCase`.
* **Legacy trigger:** `RecordAffiliateConversionOnPaymentReleaseApprovedSubscriber` (mandatory legacy flow guard, M131). A LEAD_V1 purchase can never earn a reward today. Basis is `AffiliateCommission.platformCommissionRefId` → legacy `Commission`.
* **Lead-fee side:** `LeadPurchase` (`price` = net fee, tax snapshot, status), append-only `LeadFeeLedgerEntry` (M149, type `LEAD_FEE_PAYMENT_SUCCEEDED`, unique per purchase), invoice (M150), credit note (M151), refund (M153), dispute/revocation (M155). Events: `LeadPurchaseConfirmed`, `LeadPurchaseRefunded`.
* **Rollout:** M159 `LEAD_V1_ROLLOUT_MODE`, default `DISABLED`; nothing here touches it.

## 3. Gaps found that D18 or a later step must close

1. **Referred party undecided.** Both are derivable (professional: `ProfessionalProfile.userId` → `findByUserId`; customer: `ServiceRequest` customer). The attribution lookup depends on this.
2. **"Net of Stripe fee" is not computable.** No Stripe fee is stored for lead-fee payments. The foundation supports only `NET_LEAD_FEE` (`LeadFeeLedgerEntry.netFeeAmount`) and rejects any other basis.
3. **Reversal triggers are incomplete.** `LeadPurchaseRefunded` is best-effort (no outbox) and only for `PLATFORM_ERROR` refunds; there is **no event** for REVOKED (lost chargeback/admin revocation) and no credit-note event. A reliable reversal path needs those signals, or a reconciliation sweep against purchase status. Refund policy (M153, 100 %) is untouched.
4. **Reward policy of already-paid rewards on reversal** (clawback / negative balance) is undecided; no behaviour is invented.
5. **Schema is legacy-shaped.** `AffiliateCommission` requires `conversionEventId`, `platformCommissionRefId`, `profitBaseAmount`. The roadmap proposes an additive typed source reference. No migration is created now: persistence has no consumer until D18 closes, and shipping columns would pre-commit policy-shaped fields.

## 4. What is implemented

`src/core/domain/services/lead-fee-affiliate-reward.ts` — pure, no I/O:

* `LeadFeeRewardPolicy` contract; every field mandatory (version, approval reference, referred party, basis, `rateBps`, rounding, `holdDays`). `resolveLeadFeeRewardPolicy` is strict and fail-closed; nothing is defaulted.
* `ACTIVE_LEAD_FEE_REWARD_POLICY_CONFIG = null` → `getActiveLeadFeeRewardPolicy()` is always `UNAPPROVED / POLICY_ABSENT`. Activating a policy is a reviewed edit of that one constant.
* `evaluateLeadFeeRewardEligibility`: policy first, then M149 ledger entry present and of supported type, EUR only, purchase `CONFIRMED`, attribution present and matching the policy's referred party, **existing** `detectSelfReferral` rule, partner `APPROVED`, code active, non-zero reward. The job-value estimate and the VAT-inclusive total are never inputs.
* `calculateLeadFeeRewardAmount` — bigint fixed-point, `HALF_UP`/`DOWN` per policy, no floating point. `computeLeadFeeRewardReleaseAt`. `calculateLeadFeeRewardReversalAmount` — full reversal of the remainder, replay-safe (0.00), never negative.

Not implemented (intentionally): repository/Prisma adapter, event subscriber, DI wiring, Server Action, admin view, report changes, migration, payout. Idempotency/concurrency guarantees are **not** delivered here because there is nothing persisted; the intended DB guarantee is `UNIQUE(ledger_entry_id)` on the reward and a unique key on each reversal source, following the existing `conversionEventId` / `financialAdjustmentId` pattern.

## 5. Decisions required (D18) before the next step

Reward rate and rounding; basis (net lead fee vs net after Stripe fee — requires fee capture); referred party; hold period; minimum payout; tax treatment of partner payouts; clawback behaviour for rewards already paid; attribution lock point for LEAD_V1 (existing M60 first/last-touch behaviour applies until decided); GDPR basis/retention for the attribution link on lead data (M158 boundary).

## 6. Safest next step

After D18: (a) additive migration — reward table keyed by `leadFeeLedgerEntryId` UNIQUE, policy version/approval reference/rate/basis/amount snapshot, status, releaseAt, append-only adjustment table keyed by a unique source id; (b) reliable reversal signals for REVOKED/credit note; (c) subscriber on `LeadPurchaseConfirmed` behind the legacy-independent M159 rollout guard, calling the functions above; (d) real-PostgreSQL tests for uniqueness and concurrency; (e) admin read view and report reconciliation with the lead-fee ledger.

## 7. Verification

See the completion report in the session. Tests: `tests/unit/core/domain/services/lead-fee-affiliate-reward-m162.test.ts` (54 tests; policy fail-closed, eligibility matrix, exact arithmetic, reversal, static boundary contract). Fixture rates in the test are arbitrary, test-only, and not a policy.
