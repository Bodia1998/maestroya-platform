# MaestroYa Module 115 — Legal & Business Rules Readiness Audit

Repository: `maestroya-platform-auth`
Branch: `feature/module-115-legal-business-rules-readiness`
Audit date: 2026-09-15 (UTC)
Audit type: **STRICT READ-ONLY** — no source code, tests, schema, migrations, configuration, or `legal/` content was read, inspected, or modified.

**Purpose.** This report is not legal advice and does not make legal or business decisions. It is a precise, evidence-based decision package that the MaestroYa owner can hand to a Spanish abogado/gestor so they can confirm the legal, tax, and accounting treatment required before MaestroYa processes real customers, professionals, payments, invoices, self-billing, and affiliate payouts in production.

---

## 1. Executive Summary

MaestroYa's engineering implementation is unusually well-documented about its own legal uncertainty: across the codebase, multiple domain services carry explicit doc comments flagging "GESTOR DECISION PENDING," "requires asesor fiscal / abogado sign-off," or "not a substitute for legal confirmation." This audit confirms those self-flagged items are real and current, and adds a structured inventory of every other point where the code embeds a business or legal assumption that has not been confirmed by a Spanish legal/tax professional.

The most consequential finding is a **confirmed discrepancy, by design, between two different financial calculations that use the same input data differently**: MaestroYa's live commission calculation (`CommissionCalculationService`, Module 64) includes ALL materials in the 10% commission base regardless of who purchased them, while the tax/self-billing calculation (`calculateMaestroYaTaxBreakdown`, Module 78) excludes customer-purchased materials from both the commission base and the taxable base entirely. Both code paths are independently correct implementations of two different documented business rules that were never reconciled. This is recorded here as **BUSINESS / LEGAL DECISION REQUIRED** and is not resolved by this audit, per the module's instructions.

The platform commission itself (10% of labour + materials, deducted from the professional, no separate customer fee) is a confirmed, current, single-source-of-truth engineering implementation (`commission-calculation-service.ts`). Its legal/tax characterization (VAT treatment, marketplace-intermediary status, self-billing validity) is not validated anywhere in the repository — it is implemented, not legally confirmed.

Self-billing is functionally implemented (authorization grant/revoke, invoice lifecycle, numbering, document hashing) but the actual self-billing agreement text does not exist in the codebase — only a version label placeholder (`self-billing-agreement-es-v1`) is stored, and the invoice issuer's tax ID (`MAESTROYA_ISSUER_TAX_ID`) currently resolves to a hardcoded placeholder (`PENDING-CIF-CONFIRMATION`) that is not configured in any environment file inspected during this audit, with a fail-loud guard (`IssuerTaxIdNotConfiguredError`) built specifically to stop real invoices being issued while it remains unset.

Professional verification correctly enforces a three-component rule (Identity + Selfie/Photo bundled via Persona, plus a separate Business step) as of Module 114 — this is CONFIRMED CURRENT, superseding Module 113's "STILL OPEN" classification of the same item, which was accurate only as of Module 113's own audit pass and became stale before Module 113 finished. The accepted business-registration document taxonomy (what document actually proves "autónomo" or "S.L." status — Modelo 036, alta de autónomo, IAE, etc.) is explicitly left open in the code itself as a "GESTOR DECISION PENDING" placeholder.

Affiliate earnings are calculated as 10% of MaestroYa's net profit on a booking (not 10% of the booking or of gross commission), with a €50 accumulated payout threshold. No tax withholding, invoicing obligation, or geography restriction is implemented for affiliates; the codebase does not distinguish an individual affiliate from a business affiliate, nor a Spain/EU affiliate from one located elsewhere, for any tax purpose.

GDPR erasure classifies every data category into HARD_DELETE, ANONYMIZE, or RETAIN, but no encoded time-boxed retention period exists anywhere in the codebase for RETAIN categories (financial records, disputes, audit logs, consent records, affiliate financial records) — they are retained indefinitely by current code, with no automated purge after any statutory period (e.g., a Spanish 6-year commercial/tax retention window) because no such period is encoded.

No launch blocker identified in this audit is a pure engineering defect; every Category A item below requires a legal or tax professional's decision, not a code change.

---

## 2. Scope and Methodology

This audit inspected the `maestroya-platform-auth` repository at branch `feature/module-115-legal-business-rules-readiness` (based on `master` at commit `79140e5`, itself descending from the Module 114 Persona fix). It is a static, read-only review of:

- Domain services and value objects (`src/core/domain/services/*`, `src/core/domain/value-objects/*`) governing commission, tax/IVA, invoicing/self-billing, affiliate, verification, and GDPR logic.
- Application use cases (`src/core/application/use-cases/*`) that orchestrate those domain rules for financial, invoicing, affiliate, verification, and GDPR workflows.
- Domain repositories and Prisma repository implementations, read only to confirm what is persisted, never to confirm production data.
- Prior module implementation/audit reports present in the repository root (Modules 66 through 114) as historical evidence, cross-checked against current code per the instruction that current code takes precedence over stale conclusions.
- Environment configuration surface (`.env.example`) for placeholder vs. real values, without reading `.env`/`.env.local`/`.env.production` contents beyond confirming the absence of `MAESTROYA_ISSUER_*` keys.

No file inside `legal/` was opened, listed in detail, or referenced beyond acknowledging its untracked presence. No code, test, schema, migration, or configuration file was modified. No git mutation command (`add`, `commit`, `push`, `checkout`, `switch`, `branch`, `reset`, `restore`) was run. No production API or database was contacted. The working tree was confirmed clean (only the pre-existing untracked `legal/` directory) both before and after this audit; this report is the only file this module adds.

Where a previous module's report and current code disagree, this report states the current-code finding and notes the discrepancy explicitly rather than repeating the stale conclusion.

---

## 3. Current Business Model

The code models three distinct relationships without a persisted contractual document accompanying any of them:

- **Customer ↔ Professional (or Company/S.L.)**: the professional performs the quoted work; the customer pays the quoted total (labour + materials) plus IVA.
- **Professional/Company ↔ MaestroYa**: MaestroYa deducts a flat 10% commission from the total and is the platform through which self-billing invoices and payouts flow (`invoicing-issuer.ts` names MaestroYa as "the marketplace's merchant/issuer of record").
- **Affiliate ↔ MaestroYa**: a separate, parallel relationship — an affiliate earns a share of MaestroYa's own net profit on a referred booking, unconnected to the professional's commission.

No file in the inspected source tree defines or references marketplace/intermediary status, platform liability, or liability allocation as a legal characterization; these are operational assumptions embedded in code structure (e.g., MaestroYa as invoice issuer of record) rather than stated legal positions. See §14 (Marketplace/Contractual Model).

---

## 4. Commission Model

**Implemented behavior** (`src/core/domain/services/commission-calculation-service.ts`, `commission-policy.ts`, `calculate-job-commission-breakdown.use-case.ts`):

- `commission = (labour + materials) * commissionRateBps / 10000`, default `commissionRateBps = 1000` (10%).
- `professionalPayout = total - commission`.
- The customer pays exactly `labour + materials`; there is no separate customer-facing platform fee (this replaced a historical 7.5%+7.5% dual-fee model, explicitly documented as removed and obsolete — confirmed not present in current code).
- **All** `QuoteItem` rows with `category === "MATERIALS"` are summed into the commission base in `CalculateJobCommissionBreakdownUseCase`, **regardless of `Quote.materialsStrategy`** (i.e., regardless of whether the professional or the customer purchased the materials). The code's own doc comment states this explicitly: "the commission is charged on the *value* of the materials, never on who sourced them."
- This is the single, actively used commission calculation: `RecordCommissionForPaymentUseCase`, `GetProfessionalEarningsUseCase`, `GetCustomerFinancialSummaryUseCase`, and `CreateFinancialAdjustmentUseCase` all consume `CalculateJobCommissionBreakdownUseCase`'s output.
- Discounts, refunds, partial refunds, cancellations, disputes, and chargebacks are not deducted from the commission base at calculation time; they are handled afterward as separate financial-adjustment/reversal events (`create-financial-adjustment.use-case.ts`, `reverse-professional-payout.use-case.ts`, `dispute-resolution-financial-outcome.ts`, `stripe-dispute-financial-outcome.ts`) that reduce or reverse an already-recorded commission, rather than being subtracted from the base up front.
- The commission rate is read from a `CommissionRateRepository`/`PlatformSetting` at call time, not hardcoded at each site, so an ops-level rate change does not require a deploy — this is an engineering detail, not a legal one.

**Requires legal/tax confirmation:**

- Whether "labour + all materials, regardless of purchaser" is an acceptable and IVA/commission-neutral commission base under the actual contractual/agency relationship MaestroYa has with professionals, particularly for `CUSTOMER_PURCHASED` materials the professional never priced or invoiced.
- Whether MaestroYa's commission constitutes VAT-taxable intermediation/agency service income, and if so, on what base.
- Whether discounts, partial refunds, and disputed/charged-back amounts should reduce the commission base retroactively (as currently implemented via after-the-fact reversal) or should have been excluded from the base at the point of calculation.

### 4.1 The materials discrepancy (BUSINESS / LEGAL DECISION REQUIRED)

This is the single most significant, self-documented inconsistency in the codebase:

| | Commission (`CalculateJobCommissionBreakdownUseCase`, live/active path) | Tax breakdown (`CalculateJobTaxBreakdownUseCase`, self-billing/invoice path) |
|---|---|---|
| Professional-supplied materials | Included in base | Included in base |
| Customer-purchased materials | **Included in base** (all `MATERIALS`-category items summed regardless of strategy) | **Excluded entirely** — never added to `customerTaxableBase`, `commissionBase`, or `professionalNetBase` |

Both code paths carry doc comments acknowledging this is a known, unresolved contradiction rather than a bug: the tax use case's own comment states "this use case only counts MATERIALS QuoteItems toward `professionalMaterialsAmount` when `quote.materialsStrategy === "PROFESSIONAL_SUPPLIED"`... See MODULE_78_IMPLEMENTATION_REPORT.md, 'Problems found,' for the full writeup of why this is flagged as a contradiction rather than silently patched into Module 64's own engine."

**This audit does not resolve this discrepancy.** It is flagged as **BUSINESS / LEGAL DECISION REQUIRED**: the product owner and their gestor must decide (a) which figure is the real commission base for `CUSTOMER_PURCHASED` quotes, (b) whether the live commission-recording path or the tax/self-billing path is currently wrong, and (c) what retroactive correction, if any, applies to commissions already recorded under the current (materials-inclusive) live path.

---

## 5. Materials Treatment

- `Quote.materialsStrategy` is `PROFESSIONAL_SUPPLIED` (default, "the professional's quoted price already includes materials") or `CUSTOMER_PURCHASED` (the professional gives the customer a shopping checklist; per the tax service's own doc comment, "`QuoteMaterial` has no amount field" for this strategy — MaestroYa never prices, taxes, or commissions the shopping-list items themselves).
- The commission calculation (§4) does not read `materialsStrategy` at all — it sums every `MATERIALS`-category `QuoteItem` regardless of strategy. Whether a `CUSTOMER_PURCHASED` quote can even carry priced `MATERIALS`-category `QuoteItem`s (as opposed to only the unpriced checklist) is a data-modeling question this audit did not need to resolve to observe the commission/tax base discrepancy in §4.1, since the discrepancy exists in the code's logic regardless of how often it manifests in practice.
- **Requires business/legal confirmation:** what a `CUSTOMER_PURCHASED` materials strategy legally means for MaestroYa's role (pure intermediary with zero exposure to those goods, vs. an entity whose commission is nonetheless partly calculated against their value).

---

## 6. IVA / Tax

**Implemented behavior:**

- `spain-iva-calculator.ts` / `tax-engine.ts` compute IVA at a resolved rate (general 21% default, or an explicit override).
- `maestroya-tax-calculation-service.ts` (Module 78) is the authoritative tax breakdown, layered on top of the commission engine, and separately computes: the customer's taxable base and IVA; MaestroYa's commission (delegated, never re-derived); the professional's own net base and IVA for their self-billed invoice; and an IRPF withholding figure, hardcoded to **0%** today (`CURRENT_IRPF_WITHHOLDING_RATE_BPS = 0`), documented as "per direct guidance from Agencia Tributaria relayed in the Module 78 spec" — this guidance itself is not evidenced in the repository beyond the code comment referencing it.
- `spain-community-iva-classification-policy.ts` (Module 97) implements a reduced-rate (10%) IVA classification for `COMMUNITY_OF_OWNERS` customers on qualifying renovation/repair work, gated by a materials-to-total ratio ceiling of 40% (`COMMUNITY_REDUCED_RATE_MAX_MATERIALS_RATIO`). The file's own doc comment states this is "this codebase's best-effort encoding of the publicly known shape of the rule, NOT a substitute for asesor fiscal / abogado sign-off," and every outcome this policy reaches sets a `requiresLegalConfirmation`/`taxRequiresLegalConfirmation` flag on the resulting `Quote` (`quote-repository.ts`, `create-quote.use-case.ts`, `prisma-quote-repository.ts`). This flag is persisted per-quote but this audit found no evidence of any downstream process (admin review queue, blocking gate, reporting dashboard) that consumes it — it appears to be recorded, not acted upon.
- Reduced-rate eligibility is explicitly scoped only to `COMMUNITY_OF_OWNERS` customers; the same code comment notes that `PRIVATE_CUSTOMER`/`COMPANY` customers may separately qualify for renovation-work reduced rates under Spanish law but this is out of scope and not implemented — private-customer renovation work is always taxed at whatever rate would otherwise apply (typically the 21% general rate), which is a documented gap, not a considered legal position.
- Credit notes and refunds: `calculateTaxReversal` derives a proportional reversal of customer VAT, commission, professional VAT, and IRPF from an original tax breakdown and a refunded gross amount, used by `CreateCreditNoteUseCase`.
- Tax IDs: MaestroYa's own issuer tax ID (`MAESTROYA_ISSUER_TAX_ID`) is not configured in `.env`/`.env.local`/`.env.production`/`.env.example` — it resolves to the hardcoded placeholder `PENDING-CIF-CONFIRMATION`, and `isPlaceholderIssuerTaxId` exists specifically so `IssueInvoiceUseCase` can refuse to issue a real document while this is unresolved (this audit did not trace whether that refusal is actually wired into every issuance call site — see §7).
- No Modelo 036 (or equivalent tax/business registration) reference or validation logic exists anywhere in the inspected source tree beyond a comment acknowledging it as a deferred decision (§9).

**Requires Spanish tax confirmation:**

- IVA treatment of MaestroYa's commission itself (is the commission a separate taxable supply from MaestroYa to the professional, and if so at what rate/exemption).
- Whether the IRPF withholding rate is genuinely and durably 0% for this business model, and whether that determination needs to be re-confirmed for S.L. professionals vs. autónomos.
- Whether the encoded Comunidad de Propietarios reduced-rate rule (40% materials-ratio ceiling, qualifying-work definition) matches current AEAT criteria, and what governance process should act on the `taxRequiresLegalConfirmation` flag that the code already persists but does not otherwise consume.
- Whether private-customer (non-community) renovation work should also receive reduced-rate treatment under Spanish law, and if so, the scope of that gap.
- The tax treatment of `CUSTOMER_PURCHASED` materials given the commission/tax base discrepancy in §4.1.
- Whether MaestroYa's real CIF/NIF and legal name are production-ready — as of this audit they are not configured in any inspected environment file.

---

## 7. Invoicing / Self-Billing

**Implemented behavior:**

- MaestroYa is the named issuer of record for both professional self-billed invoices and customer receipts (`invoicing-issuer.ts`), via `MAESTROYA_ISSUER_LEGAL_NAME` / `MAESTROYA_ISSUER_TAX_ID`, environment-configurable with a documented placeholder fallback.
- Invoice/credit-note numbering is sequential per year, allocated by a concurrency-safe `InvoiceNumberAllocator` (never derived from a timestamp), formatted as `INV-YYYY-NNNNNN` / `CN-YYYY-NNNNNN` (`invoice-document.ts`).
- Every invoice/credit note carries a SHA-256 tamper-evidence hash (`computeDocumentHash`) over its own financial fields. The code's own doc comment is explicit that this hash is "NOT... a qualified electronic signature, a legally binding signature, or any other form of legal attestation" — a plain integrity checksum only.
- Self-billing authorization is a first-class, gated status machine: `isSelfBillingAuthorized` requires an `ACTIVE` `SelfBillingAuthorizationRecord`; `canRevokeSelfBillingAuthorization` gates revocation to currently-`ACTIVE` records; grant/revoke use cases exist for both admin-initiated and self-service (professional-initiated) authorization (`grant-self-billing-authorization.use-case.ts`, `grant-my-self-billing-authorization.use-case.ts`, `revoke-*`).
- The self-billing "agreement" a professional accepts is represented only as a version-label string, `CURRENT_SELF_BILLING_AGREEMENT_VERSION = "self-billing-agreement-es-v1"`. The file's own doc comment states plainly: "This is NOT the legal agreement text... Module 99 does not draft, store, or render that text." No agreement wording exists anywhere in the inspected source tree.
- Invoice lifecycle events exist for creation, submission for acceptance, acceptance, issuance, cancellation, and payment-marking, each with its own domain event and audit-log subscriber.
- `CheckInvoiceRequiredForPayoutUseCase` exists, suggesting invoice issuance is (at least in some configuration) a gate on payout — this audit did not trace whether that gate is unconditionally enforced or optional/feature-flagged in the current build.

**Requires legal/accounting confirmation:**

- Whether MaestroYa's current self-billing (autofacturación) model — MaestroYa issuing the professional's invoice on their behalf under a version-labeled but textually nonexistent authorization — is legally valid for the actual relationship, and what the authorization must actually say to be valid under Spanish invoicing regulation (Real Decreto 1619/2012 and related rules on autofacturación) before it can be relied upon.
- What specific information Spanish law requires on a self-billed invoice and on a customer receipt (issuer/recipient tax IDs, VAT breakdown, numbering series requirements) and whether the current fields captured (per `invoice-document.ts`/`invoicing-issuer.ts`) satisfy that list.
- Who is legally the issuer of record for each document type (this code treats MaestroYa as issuer for both categories) and whether that is the correct legal characterization given the underlying marketplace relationship.
- Retention period required for invoices/credit notes and how it should be technically enforced (no retention period is currently encoded — see §9).
- Delivery requirements: whether an invoice/receipt must be affirmatively delivered (e.g., emailed) to the counterparty rather than merely made available for in-app retrieval — this audit did not find delivery-mechanism code beyond in-app document access; if email/other delivery exists it was not located under the searched paths.
- What must happen, procedurally and financially, when self-billing authorization is revoked mid-relationship (the code models the revoked state, but the legal consequence for in-flight or already-issued invoices is not addressed in the code).
- Whether credit notes generated by `calculateTaxReversal`/`CreateCreditNoteUseCase` are generated under legally sufficient conditions (e.g., timing, required fields) for every refund/dispute-loss trigger that produces one.

---

## 8. Affiliate Program

**Implemented behavior:**

- Affiliate earnings are entirely independent of the professional's platform commission (§3).
- Formula (`affiliate-commission-policy.ts`, Module 96 correction): `profitBase = platformCommissionAmount - attributableCostAmount` (floored at 0); `affiliateAmount = profitBase * rateBps / 10000`, default rate 10% (`AFFILIATE_COMMISSION_RATE_BPS = 1000`). `attributableCostAmount` (e.g., Stripe processing fees, chargeback losses) currently always defaults to 0 because no per-transaction fee figure is captured anywhere in the codebase yet — the code's own comment describes this as "the honest value until a real fee-capture integration exists," not a corner-cut.
- A `PENDING` affiliate commission expires (moves to `EXPIRED`, unclaimable) after 180 days if never approved (`AFFILIATE_COMMISSION_EXPIRY_DAYS`).
- Payout eligibility: an affiliate's accumulated **APPROVED** commission total must reach a threshold — default `DEFAULT_MINIMUM_PAYOUT_THRESHOLD = 50` (i.e., €50, per this module's stated product decision), overridable per-partner via `Partner.minimumPayoutThreshold`. `selectPayoutBatch` settles the entire eligible approved balance at once; there is no partial payout.
- A commission can be **partially** reversed (partial refund, partial Stripe-fee correction) while remaining `APPROVED`; `netPayableAmount` nets out any partial `reversedAmount` before payout so a partially-refunded commission is never overpaid. A **full** reversal flips the row to `REVERSED` and excludes it from payout entirely.
- Affiliate commissions are reversed automatically on the underlying payment being refunded or the underlying Stripe dispute being lost (`reverse-affiliate-commission-on-payment-refunded.subscriber.ts`, `reverse-affiliate-commission-on-stripe-dispute-lost.subscriber.ts`) — clawback exists and is event-driven, not manual.
- No field in `Partner`/affiliate repositories distinguishes an individual affiliate from a business affiliate, nor a Spain/EU-resident affiliate from one outside the EU/Spain. No country field was found on the affiliate/partner repository interfaces inspected.
- No tax-withholding, tax-ID, or invoicing-obligation field or logic exists for affiliates anywhere in the inspected source tree.

**Requires legal/accounting confirmation:**

- Whether affiliate earnings are, for Spanish tax purposes, marketing-commission/services income requiring the affiliate to issue their own invoice, or something else.
- IVA implications of paying an affiliate (is this a taxable supply from the affiliate to MaestroYa, and does self-billing apply here too, or must the affiliate invoice MaestroYa directly).
- Any withholding/retention (IRPF or otherwise) obligation on affiliate payouts — currently zero and unimplemented.
- Documentation/invoicing obligations distinguishing an individual (particular) affiliate from a business (autónomo/S.L.) affiliate — currently the code makes no such distinction at all.
- Treatment of affiliates resident outside Spain/the EU — currently unaddressed; the platform has no mechanism to even identify such affiliates today.
- Whether the €50 threshold, 180-day expiry, and "settle the full approved balance, no partial payout" cadence are acceptable from an accounting/audit-trail perspective, and whether reversed/clawed-back earnings need any specific tax documentation treatment.
- Record-retention requirements for affiliate financial records — currently retained indefinitely (`AFFILIATE_FINANCIAL` GDPR category is `RETAIN`, §9), with no encoded expiry.

---

## 9. Professional / Autónomo / S.L. Verification

**Autónomo (solo professional) path:**

- Technically enforced: identity document (one of `NATIONAL_ID`/`PASSPORT`/`DRIVER_LICENSE`) required before a verification case can be submitted; a `BUSINESS_REGISTRATION`-typed document required before the case can be `APPROVED`, enforced identically on the manual admin path and the automated Persona path (Module 98, re-confirmed current by Module 114 — see §10).
- **Explicitly left open in code**: the exact accepted business-registration document type(s) — a specific Spanish tax/registration form, "alta de autónomo," an IAE certificate, or similar — has not been specified. The code's own comment reads: *"GESTOR DECISION PENDING: the exact accepted business-registration document type(s)... have not been specified by the business/legal owner (Gestor) as of this module."* Today, only the single generic `BUSINESS_REGISTRATION` `VerificationDocumentType` value exists and is accepted, explicitly described in-code as "a technically safe placeholder," with an admin still manually reviewing the actual uploaded file — the system does not itself validate that any specific uploaded document proves autónomo status; it only checks that *a* document of this generic type was submitted and an admin approved the case.
- Manually reviewed (not automatically verified beyond Persona's identity outcome): an admin approves or rejects the whole verification case; there is no per-document automated content validation.
- Insurance and professional licenses/certifications: `VerificationDocumentTypeValue` includes `INSURANCE_CERTIFICATE` and `PROFESSIONAL_CERTIFICATION` as acceptable upload types, but this audit found no rule making either mandatory for any professional category — their presence is optional/informational unless a business rule elsewhere requires them (none was found).

**S.L. (company) path:**

- Company verification (`company-verification-rules.ts` and related use cases) requires `BUSINESS_LICENSE`/`TAX_CERTIFICATE` at submission time — per Module 114's own note, this is "stronger than the professional path" and was never affected by the Persona-bypass issue since it has no automated shortcut.
- This audit did not independently trace how the authority of the specific individual submitting on behalf of an S.L. (i.e., proof they are an authorized representative/administrator) is verified beyond document upload and admin review; no dedicated "representative authority" verification step distinct from document upload was located in the searched files.

**What is enforced vs. decided vs. reviewed:**

| | Autónomo | S.L. |
|---|---|---|
| Technically enforced | Identity doc present; a `BUSINESS_REGISTRATION`-typed doc present; both required before `APPROVED` | `BUSINESS_LICENSE`/`TAX_CERTIFICATE` present at submission |
| Manually reviewed | Yes — admin approves/rejects the whole case | Yes — admin approves/rejects the whole case |
| Automatically verified | Only identity (+ bundled selfie/liveness) via Persona | No automated path exists |
| Legal/business decision open | Which document(s) actually satisfy "business registration" (Modelo 036/alta de autónomo/IAE); whether registry/API verification (vs. document upload) is required; whether insurance/licensing should be mandatory per service category | Same open question on which documents satisfy company verification, and how representative authority is confirmed |

---

## 10. Persona / Identity / Selfie Verification

Per Module 114 (re-verified current by this audit's direct reading of `refresh-verification-status.use-case.ts` and `professional-verification-rules.ts`):

- Persona's `VERIFIED` outcome is treated, for the automated path only, as covering **both** Identity and Selfie/Liveness together, because Persona's own hosted inquiry flow performs both checks before ever returning that single outcome. The codebase has no independent representation of a separate "selfie" document type or result — `VerificationDocumentType` has no `SELFIE`/`PHOTO` value, and this audit confirms (per this module's own instruction) that no such type should be proposed.
- Business verification remains a fully independent, separately-enforced gate: a Persona `VERIFIED` result **cannot** by itself produce a profile `VERIFIED` status without a `BUSINESS_REGISTRATION`-typed document also present and case-approved — confirmed both in the webhook path (`ProcessPersonaWebhookUseCase` delegates entirely to `RefreshVerificationStatusUseCase`) and the batch-sync path (`SynchronizeVerificationUseCase`).
- Manual-review and Persona/webhook paths converge on the identical `hasBusinessRegistrationDocument` predicate — there is exactly one definition of "is business-verified," not two that could diverge.
- Payout eligibility (`CheckPayoutEligibilityUseCase`) derives strictly from case status `APPROVED`, which per the above can no longer be reached via Persona alone — payout gating inherits the same protection.
- Data minimization: `persona-verification-provider.ts`'s own doc comment states selfie images "live only in Persona's own systems" — MaestroYa never receives or stores the selfie image itself, only Persona's pass/fail outcome.

**Cross-module status correction:** Module 113's final pre-launch audit (`MaestroYa_Module_113_Final_Pre_Launch_Audit_Report.md`, item `M98-H1`) listed this exact bypass as **"STILL OPEN"** and a launch blocker, explicitly noting it had not re-verified against current code. Module 114 performed that re-verification and found the fix (from an earlier Module 98 commit, `61abe93`) was already merged and present before Module 114 began, adding ten regression tests to pin the invariant down explicitly. **This item is therefore RESOLVED as of current code, not open**, and Module 113's table entry is stale/superseded — see §17 for the full cross-module consistency check.

**Legal/privacy questions requiring confirmation (not answered here):**

- What verification evidence (beyond Persona's bundled outcome) MaestroYa should itself retain vs. leave solely with Persona, and for how long.
- Deletion/retention requirements for verification documents after account deletion — current code hard-deletes `VERIFICATION_DOCUMENTS` on erasure (§11) with no legal-hold exception encoded.
- Manual-review escalation and fraud-escalation requirements when Persona and the business-document review disagree.
- Re-verification triggers (e.g., after an approval expires at 365 days — `APPROVAL_VALIDITY_DAYS`) and what evidence must be re-collected at that point.
- Whether the current architecture's inability to independently gate a "selfie-only" requirement (distinct from Persona's bundled outcome) for the manual review path is acceptable, or whether a future product/legal decision should introduce one (explicitly flagged in Module 114's own report as a known limitation, not a defect).

---

## 11. GDPR / Data Retention

**Implemented behavior** (`gdpr-privacy-rules.ts`, Module 38/88):

- Every data category is classified into exactly one of `HARD_DELETE`, `ANONYMIZE`, or `RETAIN`:
  - `HARD_DELETE`: `AUTH_CREDENTIALS`, `NOTIFICATIONS`, `VERIFICATION_DOCUMENTS`.
  - `ANONYMIZE`: `PROFILE_DATA`, `MARKETPLACE_ACTIVITY`, `MESSAGES`, `REVIEWS`, `COMPANY_MEMBERSHIP`, `REFERRAL_ATTRIBUTION`.
  - `RETAIN`: `MARKETPLACE_FINANCIAL`, `DISPUTES_AND_SUPPORT`, `AUDIT_LOG`, `CONSENT_RECORDS`, `AFFILIATE_FINANCIAL`.
- `ExecuteAccountErasureUseCase` (Module 88) only ever touches `HARD_DELETE`/`ANONYMIZE` categories; `RETAIN` categories have no repository wired into the erasure use case at all — by construction, they are never touched by account deletion.
- Cloudinary-hosted verification documents are purged as part of hard-deletion, with a retry mechanism for failed purges (`retry-pending-cloudinary-purges.use-case.ts`, `gdpr-cloudinary-purge-policy.ts`) and a scheduled cron sweep (`/api/cron/gdpr-cloudinary-purge`).
- **No time-boxed retention period is encoded anywhere for any `RETAIN` category.** The only "retention days" concept found in the codebase (`BACKUP_RETENTION_DAYS`, default 30) governs infrastructure database backups, not GDPR-relevant financial/legal records. Financial, dispute, audit-log, and affiliate-financial data is retained indefinitely by current code — there is no automated purge after any statutory period.
- Financial records retention rationale is stated in-code as GDPR Art. 17(3)(b)/(e) (legal obligation / establishment/defense of legal claims), described in the same file as this module's "own MVP interpretation," explicitly not sourced from a product/legal spec.

**Legal questions requiring confirmation (one per material category):**

- `MARKETPLACE_FINANCIAL` / `AFFILIATE_FINANCIAL` (retained indefinitely today): what is the actual required minimum **and maximum** retention period for job/payment/commission/affiliate records under Spanish commercial and tax law (commonly cited around 6 years, but this figure appears nowhere in the codebase and is not confirmed here), and should the system enforce an upper bound (purge after N years) rather than retaining forever?
- `AUDIT_LOG`: same question — is indefinite retention appropriate, or does data-minimization require a maximum retention window?
- `CONSENT_RECORDS`: what retention period is needed to prove consent was validly obtained/withdrawn, and is indefinite retention proportionate?
- `DISPUTES_AND_SUPPORT`: what is the applicable limitation period for legal claims in Spain that should bound retention, rather than indefinite retention?
- `VERIFICATION_DOCUMENTS` (hard-deleted on account erasure): is immediate hard-delete on account deletion appropriate given any KYC/AML-adjacent regulatory retention obligation that might apply, or does a legal-hold exception need to be added for documents tied to an unresolved dispute or investigation?
- Whether Persona's own retention of identity/selfie evidence (outside MaestroYa's own systems, per §10) needs a documented data-processing-agreement basis distinct from MaestroYa's own retention policy.

---

## 12. Marketplace / Contractual Model

The code structurally distinguishes four roles (customer, professional/company, MaestroYa, affiliate) via separate domain entities, repositories, and authorization checks, but does not encode or reference any of the following as an explicit legal characterization: marketplace/intermediary status, platform liability limits, professional liability, workmanship warranties, or no-show/cancellation liability allocation. What exists operationally:

- **Refunds**: `ExecuteRefundUseCase`/`reverse-professional-payout.use-case.ts` implement refund execution with professional-payout reversal, gated by the same distributed lock used for payout execution and dispute settlement (`payout:execute:<jobId>`) to prevent race conditions between a refund, a payout, and a lost dispute for the same job.
- **Disputes**: `Dispute`/`DisputeResolution` domain objects and `ResolveDisputeWithFinancialOutcomeUseCase` (Module 68) connect an admin's dispute resolution decision to an actual, idempotent financial adjustment — this closed a previously-identified gap where a dispute resolution did not move money.
- **Chargebacks**: `ProcessStripeDisputeWebhookUseCase` maps Stripe's raw dispute states to an internal open/under-review/won/lost model and, on a lost dispute, triggers financial-adjustment creation and (via subscriber) affiliate-commission reversal.
- **Service completion confirmation, workmanship complaints, and no-show behavior** were not located as dedicated domain concepts distinct from the general dispute/support-ticket mechanism during this audit's search — if such flows exist under different naming, they were not surfaced by the search terms used and should be independently confirmed rather than assumed absent.

**Legal questions requiring confirmation:**

- Whether MaestroYa's current operational posture (issuer of record for invoices, controller of payout timing, resolver of disputes with binding financial outcomes) is consistent with a pure-intermediary/marketplace legal characterization, or whether it creates exposure closer to a direct-service-provider characterization.
- What contractual terms (Terms of Service, professional agreement, customer agreement) currently exist outside the codebase to allocate liability for workmanship, damages, cancellations, and no-shows — this audit found onboarding "terms accepted"/"privacy policy accepted" acceptance-tracking use cases (`accept-onboarding-terms.use-case.ts`, `accept-onboarding-privacy-policy.use-case.ts`) confirming that *some* terms-acceptance flow exists and is tracked, but the actual terms text was not located in the searched application source and was not sought inside `legal/`, per this module's read-only-audit and `legal/`-exclusion instructions.
- Whether Stripe Connect's own platform-liability/dispute-responsibility terms (as configured for this account) are aligned with MaestroYa's own dispute-resolution and refund logic as implemented.

---

## 13. Legal Questions Requiring Professional Advice (Category A Detail)

Each item below requires Spanish legal (abogado) and/or tax/accounting (gestor) confirmation before launch reliance. IDs are referenced in the executive table (§15) and final matrix (§16).

| ID | Topic | Current implementation | Exact decision required | Why it matters | Code/module evidence | Consequence if wrong |
|---|---|---|---|---|---|---|
| L-01 | Commission base for `CUSTOMER_PURCHASED` materials | Commission engine includes all materials; tax engine excludes customer-purchased materials — the two disagree | Which base is correct, and how to reconcile/backfill already-recorded commissions | Directly affects every professional's payout and every tax figure on self-billed invoices | `commission-calculation-service.ts`; `maestroya-tax-calculation-service.ts`; MODULE_78_IMPLEMENTATION_REPORT.md | Miscalculated payouts/invoices at scale; potential tax misstatement |
| L-02 | IVA treatment of MaestroYa's commission | Commission is deducted from professional payout; no separate IVA line item for the commission itself is modeled as a distinct taxable supply | Whether MaestroYa's commission is its own VAT-taxable supply and at what rate/exemption | Determines whether MaestroYa under- or over-states its own VAT liability | `maestroya-tax-calculation-service.ts` | Tax underpayment/overpayment; AEAT exposure |
| L-03 | IRPF withholding rate (currently 0%) | Hardcoded to zero, described as AEAT-confirmed guidance relayed via a spec, not independently evidenced in-repo | Confirm 0% is correct and durable for this business model and professional type (autónomo vs. S.L.) | Wrong withholding is a compliance failure for both MaestroYa and the professional | `maestroya-tax-calculation-service.ts` (`CURRENT_IRPF_WITHHOLDING_RATE_BPS`) | Withholding compliance failure |
| L-04 | Comunidad de Propietarios reduced IVA rate rule | 40% materials-ratio ceiling and qualifying-work test implemented as a best-effort encoding; every REDUCED outcome sets an unconsumed `taxRequiresLegalConfirmation` flag | Confirm the encoded rule matches current AEAT criteria; decide what process acts on the persisted flag | Wrong classification is a live tax-rate error on every affected invoice | `spain-community-iva-classification-policy.ts` | Incorrect IVA charged/remitted |
| L-05 | Self-billing (autofacturación) legal validity | Authorization is a status machine with a version-label only; no agreement text exists in the codebase | Confirm the model is valid autofacturación under Spanish invoicing rules, and supply real agreement text/required disclosures | Self-billing without a valid authorization is a compliance and audit risk | `self-billing-agreement.ts`; `self-billing-authorization-rules.ts` | Invoices could be legally invalid |
| L-06 | Invoice issuer tax ID | `MAESTROYA_ISSUER_TAX_ID` unset in every inspected env file; resolves to placeholder `PENDING-CIF-CONFIRMATION` | Supply MaestroYa's real CIF and confirm issuer legal name before any production invoice | An invoice with a placeholder tax ID is not a valid tax document | `invoicing-issuer.ts` | Invalid invoices in production |
| L-07 | Business-registration document taxonomy | Only a generic `BUSINESS_REGISTRATION` document type exists; explicitly marked "GESTOR DECISION PENDING" in code | Specify exactly which document(s) (Modelo 036, alta de autónomo, IAE, etc.) satisfy the requirement | Determines whether "verified" professionals are actually lawfully registered | `professional-verification-rules.ts` | Onboarding professionals without adequate proof of tax/business status |
| L-08 | Affiliate earnings tax/invoicing treatment | No tax ID, withholding, or invoicing logic for affiliates; no individual-vs-business distinction | Confirm whether affiliates must invoice MaestroYa, whether withholding applies, and how individual vs. business affiliates differ | Affects every affiliate payout going forward | `affiliate-commission-policy.ts`; `partner-payout-rules.ts` | Tax/invoicing non-compliance on affiliate payouts |
| L-09 | Affiliates outside Spain/EU | No country field or cross-border tax logic exists for affiliates | Decide whether non-Spain/non-EU affiliates are permitted, and if so their tax treatment | Cross-border payouts carry different withholding/reporting obligations | Affiliate/partner repository interfaces (no country field found) | Unhandled cross-border tax exposure |
| L-10 | Retention period for financial/audit/consent/affiliate records | Retained indefinitely; no encoded maximum or statutory-period-based purge | Confirm minimum AND maximum required retention periods, and whether indefinite retention is itself a GDPR data-minimization risk | Both under-retention (destroying records needed for tax defense) and over-retention (GDPR minimization violation) are risks | `gdpr-privacy-rules.ts` | Regulatory exposure either direction |
| L-11 | Verification document retention on account deletion | Hard-deleted immediately on erasure, no legal-hold exception | Confirm immediate hard-delete is appropriate given any applicable KYC-adjacent retention obligation | Deleting evidence needed for an active dispute/investigation could be a problem | `gdpr-privacy-rules.ts` (`VERIFICATION_DOCUMENTS: HARD_DELETE`) | Loss of evidence needed for legal defense |
| L-12 | Marketplace/intermediary legal characterization | MaestroYa acts operationally as invoice issuer of record, payout controller, and binding dispute resolver | Confirm this operational posture matches (or should be adjusted to match) the intended marketplace/intermediary legal status | Misalignment could shift liability exposure onto MaestroYa | `invoicing-issuer.ts`; dispute-resolution use cases | Unintended liability exposure |
| L-13 | Private-customer renovation reduced IVA rate | Not implemented — only Community of Owners gets reduced-rate treatment | Confirm whether private-customer renovation work also qualifies under Spanish law and whether to implement it | A missed legal reduced-rate opportunity, or confirmation that scope is correctly limited | `spain-community-iva-classification-policy.ts` (doc comment, explicit scope note) | Overcharging IVA to private customers if the rate should apply |
| L-14 | Self-billed invoice delivery requirement | No dedicated delivery (e.g., email) mechanism located beyond in-app document access | Confirm whether affirmative delivery to the counterparty is legally required, beyond availability for retrieval | Some invoicing regimes require delivery, not just availability | Invoicing use cases (`get-professional-invoice.use-case.ts`, `get-customer-receipt.use-case.ts`) | Invoices deemed not properly issued/delivered |

---

## 14. Business Decisions Requiring Owner Decision (Category B)

| ID | Topic | Current state | Decision needed |
|---|---|---|---|
| B-01 | Commission/tax materials reconciliation (business side) | Two disagreeing implementations exist | Which rule should govern going forward, independent of the legal confirmation in L-01 |
| B-02 | Business-registration document list | Placeholder generic type only | Owner + gestor jointly decide the accepted document list (this is listed in both A and B because the *decision* is a legal/tax question but the *product configuration* of which document types the UI accepts is an owner-facing choice) |
| B-03 | Mandatory insurance/licensing by service category | Optional document types exist; no category-specific mandate | Decide which service categories (if any) require insurance/licensing before activation |
| B-04 | Affiliate program geography | No restriction encoded | Decide whether to formally restrict the affiliate program to Spain/EU residents until cross-border tax handling exists |
| B-05 | €50 affiliate payout threshold / 180-day expiry / full-balance-only payout | Implemented as stated in the module brief | Confirm these remain the intended cadence, or adjust |
| B-06 | Reduced-rate IVA scope (private-customer renovation) | Not implemented | Decide whether to invest in implementing this once legally confirmed (L-13) |
| B-07 | GDPR retention maximums | Indefinite by default | Decide target retention windows per category, subject to legal minimums/maximums from L-10 |

---

## 15. Executive Decision Table

| ID | Topic | Current implementation | Decision required | Owner | Priority |
|---|---|---|---|---|---|
| L-01 | Commission base for CUSTOMER_PURCHASED materials | Two disagreeing calculations | Reconcile commission vs. tax base | Lawyer + Gestor | Launch blocker |
| L-02 | IVA on MaestroYa's own commission | Not modeled as separate taxable supply | Confirm VAT treatment of commission | Gestor | Launch blocker |
| L-03 | IRPF withholding = 0% | Hardcoded default | Confirm durability of 0% rate | Gestor | Launch blocker |
| L-04 | Community-of-owners reduced IVA rule | Best-effort encoding, flag unconsumed | Confirm rule + define process for the flag | Gestor + Lawyer | Launch blocker |
| L-05 | Self-billing legal validity/text | Status machine only, no agreement text | Supply and confirm real authorization text | Lawyer | Launch blocker |
| L-06 | Invoice issuer tax ID | Placeholder, unset in all env files | Supply real CIF/legal name | Owner (operational) + Gestor (confirm) | Launch blocker |
| L-07 | Business-registration document taxonomy | Generic placeholder type | Specify accepted documents | Gestor | Launch blocker |
| L-08 | Affiliate tax/invoicing treatment | Not implemented | Confirm obligations | Gestor | Pre-launch |
| L-09 | Non-Spain/EU affiliates | Not addressed | Decide policy | Lawyer + Gestor | Pre-launch |
| L-10 | Financial/audit/consent retention period | Indefinite | Confirm min/max periods | Lawyer + Gestor | Pre-launch |
| L-11 | Verification document retention on erasure | Immediate hard-delete | Confirm legal-hold need | Lawyer | Pre-launch |
| L-12 | Marketplace/intermediary characterization | Operationally invoice-issuer/dispute-resolver | Confirm legal characterization | Lawyer | Pre-launch |
| L-13 | Private-customer renovation reduced IVA | Not implemented | Confirm scope | Gestor | Post-launch |
| L-14 | Self-billed invoice delivery requirement | Not confirmed as implemented | Confirm delivery obligation | Lawyer | Pre-launch |
| B-03 | Mandatory insurance/licensing | Optional | Owner decision, category-by-category | Owner | Post-launch |
| B-04 | Affiliate geography restriction | Unrestricted | Owner decision pending L-09 | Owner | Pre-launch |

---

## 16. Final Launch Decision Matrix

| Area | Current technical state | Legal decision needed? | Business decision needed? | Engineering work needed? | Launch blocker? |
|---|---|---|---|---|---|
| 10% commission (labour+materials, deducted from professional) | Implemented, single source of truth | Yes (VAT/agency characterization) | No (already decided) | No | Pre-launch (legal confirmation only) |
| Materials treatment (CUSTOMER_PURCHASED discrepancy) | Two disagreeing calculations, both documented | Yes | Yes (which rule governs) | Possibly, once decided | **Launch blocker** |
| IVA (general + community reduced rate) | Implemented with a self-flagged, unconsumed legal-confirmation marker | Yes | No | Possibly (wire up the flag to a process) | **Launch blocker** |
| Self-billing / invoicing | Functional lifecycle; no agreement text; placeholder tax ID | Yes | No | No (text/config only, not code) | **Launch blocker** |
| Invoices / credit notes | Numbering, hashing, lifecycle implemented; hash explicitly not a legal signature | Yes (delivery/format requirements) | No | Unknown pending legal answer | Pre-launch |
| Affiliate payouts / €50 threshold | Implemented as specified | Yes (tax/invoicing treatment) | Yes (geography) | No | Pre-launch |
| Autónomo verification | Identity + generic business-doc type enforced | Yes (document taxonomy) | Yes (which documents to accept) | Minor (config, once decided) | **Launch blocker** |
| S.L. verification | Business license/tax certificate required | Yes (representative-authority sufficiency) | No | Unknown pending legal answer | Pre-launch |
| Persona / selfie-liveness | Three-component rule enforced and tested (Module 114, confirmed current) | No further legal blocker identified here | No | No | Resolved — not a blocker |
| GDPR / document retention | Categorized (hard-delete/anonymize/retain); no time-boxed purge for RETAIN | Yes (retention windows) | Yes (target windows once legal minimum/maximum known) | Yes (implement purge once periods are set) | Pre-launch |
| Refunds / disputes / chargebacks | Financially wired, idempotent, lock-protected | Yes (liability allocation) | No | No | Pre-launch |
| Marketplace/professional liability | Not encoded as legal terms in this codebase (ToS existence tracked, text not located here) | Yes | No | No | Pre-launch |
| Production configuration / Redis / DB capacity / HTTP load testing | Covered by prior modules (105–113); not this module's scope | No | No | Per prior modules' own findings | Per prior modules |

---

## 17. Cross-Module Consistency Check

- **Module 113 item `M98-H1`** ("Persona automated-approval path bypasses business-registration verification"), listed as **STILL OPEN / launch blocker**, is **RESOLVED as of current code**. Module 113 explicitly noted it had not re-verified this item against code; Module 114 performed that re-verification, found the underlying fix already merged from an earlier commit, added ten regression tests, and made no further code change. This audit independently re-read `refresh-verification-status.use-case.ts` and `professional-verification-rules.ts` and confirms the three-component gate (Identity+Selfie via Persona, Business via document) is enforced identically on the manual, webhook, and batch-sync paths. **This report supersedes Module 113's classification of M98-H1.**
- **Module 78's** "materials commission/tax discrepancy" finding (referenced by its own current-code doc comments as still unresolved "Problems found") is **CONFIRMED STILL OPEN** by this audit's direct reading of both `commission-calculation-service.ts` and `maestroya-tax-calculation-service.ts` — no later module (79–114) claims to have reconciled it, and no evidence of a fix exists in the repository's module-report trail.
- **Module 79/85/99's** self-billing agreement-text gap ("the actual agreement wording... not implemented here and must be supplied and confirmed separately," per Module 79's own report §16, referenced verbatim in Module 99's `self-billing-agreement.ts`) is **CONFIRMED STILL OPEN** — this audit found no agreement text anywhere in the current source tree.
- **Module 97's** community-IVA-classification legal-confirmation flag (`taxRequiresLegalConfirmation`) is **CONFIRMED PERSISTED BUT NOT CONSUMED** — the field is written on every `Quote` but this audit found no downstream reader/process/dashboard for it in the searched application code.
- **Module 98's** "GESTOR DECISION PENDING" business-registration-document-taxonomy gap is **CONFIRMED STILL OPEN** — the code comment is unchanged and no later module claims to have resolved it.
- **Module 96's** affiliate-formula correction (profit-base, not gross-commission) is **CONFIRMED CURRENT** — `affiliate-commission-policy.ts` implements the corrected formula, matching the module's own worked example.
- No other Module 113 legal/business-relevant blocker was found in that report's table besides M98-H1; the remaining Module 113 items (M109-F2, M112-F1, M103-Med2, M105-Med2/M107-F1) are environment/infrastructure/testing items outside this module's legal/business scope and are not restated here.
- This audit found no evidence contradicting Module 114's own conclusions; it independently corroborates them from the current source rather than merely repeating them.

---

## 18. Engineering / DevOps Items (Category C — no lawyer needed)

- Wiring the persisted `taxRequiresLegalConfirmation` flag to an actual admin review queue or blocking gate, once legal confirmation of the underlying rule (L-04) exists.
- Implementing a time-boxed retention/purge job for `RETAIN`-classified GDPR categories, once a retention period is legally confirmed (L-10).
- Confirming whether `CheckInvoiceRequiredForPayoutUseCase` is unconditionally enforced as a payout gate in the current build (not fully traced by this audit) — a technical verification, not a legal one.
- Capturing a real per-transaction Stripe processing-fee figure to feed `attributableCostAmount` in the affiliate profit-base calculation (currently always 0 by honest default, not a defect).
- Configuring `MAESTROYA_ISSUER_LEGAL_NAME` / `MAESTROYA_ISSUER_TAX_ID` in production environment configuration once the real values are confirmed (an operational/config task, not a code change).

---

## 19. Post-Launch / Optional Items (Category D)

- Private-customer (non-community) renovation reduced-IVA-rate implementation, pending L-13.
- Category-specific mandatory insurance/licensing enforcement (B-03), if the owner decides to require it.
- A formal, independently-gateable "selfie/photo" requirement for the manual (non-Persona) verification path, explicitly flagged by Module 114 as a known architectural limitation rather than a defect, requiring a future schema/product decision.
- Any refinement of dispute/no-show/workmanship-complaint modeling beyond the current dispute/support-ticket mechanism, if the owner's ToS calls for finer-grained categories than this audit located.

---

## 20. Files Inspected (representative, not exhaustive)

Domain services: `commission-calculation-service.ts`, `commission-policy.ts`, `maestroya-tax-calculation-service.ts`, `tax-engine.ts`, `tax-calculator.ts`, `spain-iva-calculator.ts`, `spain-community-iva-classification-policy.ts`, `affiliate-commission-policy.ts`, `partner-payout-rules.ts`, `self-billing-agreement.ts`, `self-billing-authorization-rules.ts`, `invoicing-issuer.ts`, `invoice-document.ts`, `invoice-lifecycle.ts`, `professional-verification-rules.ts`, `company-verification-rules.ts`, `verification-expiration-rules.ts`, `gdpr-privacy-rules.ts`, `gdpr-cloudinary-purge-policy.ts`, `materials-strategy.ts`, `materials-procurement-rules.ts`.

Application use cases: `calculate-job-commission-breakdown.use-case.ts`, `calculate-job-tax-breakdown.use-case.ts`, `record-commission-for-payment.use-case.ts`, `create-financial-adjustment.use-case.ts`, `refresh-verification-status.use-case.ts`, `process-persona-webhook.use-case.ts`, `synchronize-verification.use-case.ts`, invoicing use-case directory (grant/revoke self-billing authorization, create/issue/cancel invoice, create credit note), affiliate use-case directory (record/reverse/expire affiliate commission, request/create partner payout), GDPR use-case directory (execute account erasure, export personal data), dispute-resolution and stripe-disputes use cases.

Infrastructure: `persona-verification-provider.ts`, `persona-client.ts`, Prisma repositories for commission, invoice, self-billing authorization, affiliate commission/payout, financial ledger; `.env.example` (checked for `MAESTROYA_ISSUER_*`/tax-ID configuration, not found).

Prior module reports (root of repository): Modules 66–114 implementation/audit reports, read for historical context and cross-checked against current code per §17.

`legal/` directory: **not inspected**, per this module's explicit instruction.

---

## 21. Limitations

- This is a static code and documentation review; it does not execute the application, does not query any database, and does not verify runtime behavior beyond what prior modules' own test-execution reports (e.g., Module 104, Module 114) already document.
- The actual Terms of Service, professional agreement, and privacy policy text (if they exist outside the `legal/` directory or outside this repository entirely) were not located and not evaluated; only the fact that an acceptance-tracking mechanism exists was confirmed.
- The `legal/` directory's contents were deliberately not read, per instruction; if it already contains answers to some of the questions in §13, that overlap could not be confirmed or excluded by this audit.
- Persona's own internal retention/processing practices were not independently verified beyond what MaestroYa's own integration code and its doc comments describe.
- This audit reflects the repository state at the commit inspected; any code, environment, or configuration change afterward is not reflected here.

---

## 22. Final Verdict

MaestroYa's legal and business-rules readiness is **not legally validated by the repository** in its current state. The engineering implementation is deliberate, internally consistent within each individual code path, and unusually transparent about its own open legal questions — multiple files explicitly self-flag decisions as "GESTOR DECISION PENDING" or "requires asesor fiscal / abogado sign-off" rather than silently assuming a common practice is sufficient. However, at least one confirmed cross-module discrepancy (commission vs. tax treatment of customer-purchased materials), one confirmed missing legal artifact (self-billing agreement text) paired with a fail-loud but currently-triggered placeholder (invoice issuer tax ID), and one explicitly open document-taxonomy decision (business-registration proof) each independently block a defensible claim of production readiness for real invoicing, self-billing, and payouts. None of these are described here as "non-compliant" — that would overstate what a missing confirmation proves — they are described as **requiring professional tax/legal confirmation before launch**, consistent with this module's instruction not to convert an engineering assumption into a legal conclusion in either direction.

## Final Score

**Legal & Business Readiness: 46 / 100.**

Basis for this score:
- Documented decisions (+): the codebase itself documents almost every open question precisely, with named files and explicit "requires confirmation" markers — this is unusually strong traceability for a pre-launch platform and materially reduces the work needed to brief a lawyer/gestor.
- Implementation traceability (+): every commission, tax, invoicing, affiliate, and verification figure can be traced to exactly one authoritative function, with no scattered duplicate logic (the one exception, §4.1, is itself explicitly documented as a known unresolved duplication).
- Unresolved legal questions (–): fourteen distinct Category A items (§13) remain open, five of which are launch blockers (§16) touching the core revenue calculation, tax treatment, and invoicing validity.
- Accounting/tax clarity (–): the central commission/tax base discrepancy (§4.1) and the unconfirmed IRPF/community-IVA rules mean the platform cannot currently produce a self-billed invoice or tax figure with confirmed legal correctness.
- Contractual clarity (–): no self-billing agreement text exists, and the marketplace/intermediary legal characterization is implicit in code structure rather than confirmed.
- GDPR/document-retention clarity (–): retention classification exists but no retention period (minimum or maximum) is encoded for any financial/legal-hold category, leaving both under- and over-retention risk unaddressed.

This score reflects legal and business-rules readiness only, not overall platform/engineering readiness, which prior modules (104–113) have assessed separately.

---

## Final Output Summary

- **Exact report path:** `MaestroYa_Module_115_Legal_Business_Rules_Readiness_Report.md` (repository root, `maestroya-platform-auth`).
- **Exact current branch:** `feature/module-115-legal-business-rules-readiness`.
- **Exact files changed:** only this report was created; no other file in the repository was modified. `legal/` remains untracked and untouched.
- **Legal questions requiring lawyer/gestor:** L-01 through L-14 (§13).
- **Business decisions requiring owner decision:** B-01 through B-07 (§14).
- **Engineering blockers:** none identified as legal/business blockers in this module; residual engineering follow-ups are Category C (§18), none of which require a lawyer.
- **Launch blockers (Category A/B combined, per §16):** materials commission/tax discrepancy (L-01/B-01), IVA on MaestroYa's commission (L-02), IRPF withholding confirmation (L-03), community-IVA rule confirmation (L-04), self-billing agreement text and validity (L-05), invoice issuer tax ID (L-06), business-registration document taxonomy (L-07/B-02).
- **Tests/checks performed:** direct source-code inspection of the domain services, use cases, and repositories listed in §20; cross-reference against Module reports 66–114; confirmation that `.env`/`.env.example` do not configure `MAESTROYA_ISSUER_*`; git working-tree status confirmed clean (only untracked `legal/`) before and after the audit; no code, test, schema, or configuration file modified; `legal/` not inspected.
- **Final Legal & Business Readiness score:** 46/100.
- **Final verdict:** Not legally validated by the repository; multiple launch-blocking legal/tax/accounting confirmations remain outstanding; engineering implementation is traceable, internally documented, and ready to be corrected quickly once each confirmation is obtained.
