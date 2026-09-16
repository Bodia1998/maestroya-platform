# MaestroYa — Legal Consultation Decision Package

Repository: `maestroya-platform-auth`
Branch: `feature/module-116-legal-consultation-decision-package`
Prepared: 2026-09-16 (UTC), based on Module 115 (`MaestroYa_Module_115_Legal_Business_Rules_Readiness_Report.md`, audit date 2026-09-15), with current-code re-verification of every high-stakes claim (see §16, Verification Log).

---

## 1. Purpose

This document is intended for consultation with a Spanish **abogado** (lawyer), an **asesor fiscal / gestor** (tax advisor / accountant), or both, depending on the question.

This document describes MaestroYa's **current technical and business implementation** and asks the professional advisor to confirm the applicable legal, tax, accounting, and contractual treatment for each item below.

**It is NOT legal advice. It is NOT tax advice. It does not draw any legal or tax conclusion.** Every "current behavior" statement below describes what the code does today, not what the code should do or what is legally required. Every question is phrased so the advisor can answer it directly, in writing, without needing to read the full source codebase.

---

## 2. MaestroYa Business Model — Short Context

MaestroYa is a marketplace platform connecting **customers** who need home-service work done with **professionals** (autónomos or S.L. companies) who perform that work.

- **Customer**: requests a job, receives a quote (labour + materials), pays the quoted total plus IVA.
- **Professional / Company**: quotes and performs the work; is verified before activation (identity + business documentation); receives payout of the quoted total minus MaestroYa's commission.
- **MaestroYa's role**: operates the marketplace, verifies professionals, processes payments (via Stripe), deducts a flat commission from each job, issues invoices on behalf of professionals ("self-billing"/autofacturación) and receipts to customers, resolves disputes with binding financial outcomes, and controls payout timing.
- **Professional verification**: identity document + selfie/liveness (via Persona, a third-party identity-verification provider) + a business-registration document, reviewed by an admin before a professional is activated.
- **Quoting**: a professional submits a quote broken into labour and materials line items; materials may be professional-supplied (priced) or customer-purchased (an unpriced shopping checklist).
- **Payment**: the customer pays the full quoted total (no separate platform fee charged to the customer) via Stripe.
- **Commission**: MaestroYa deducts a flat 10% of the total from the professional's payout.
- **Payout**: the professional receives total minus commission, released after job completion and any applicable holds.
- **Invoicing / self-billing**: MaestroYa issues the professional's invoice on their behalf (autofacturación) under a self-billing authorization the professional grants, and issues a receipt to the customer.
- **Refunds / disputes**: refunds, disputes, and Stripe chargebacks each trigger financial reversal logic that adjusts commission, professional payout, and (where applicable) affiliate earnings.
- **Affiliate program**: a separate program in which an affiliate/partner earns a percentage of MaestroYa's own net profit (commission minus attributable costs) on a referred booking — entirely independent of the professional's commission.

---

## 3. Current Commercial Model

- **Platform commission**: flat 10% (`DEFAULT_COMMISSION_RATE_BPS = 1000`), configurable at the ops level via a `PlatformSetting`/`CommissionRateRepository`, not hardcoded per call site.
- **Commission base**: `labour + materials` (both categories of `QuoteItem`), i.e. the full quoted total.
- **Who pays the commission**: deducted entirely from the professional's payout. The customer pays the full quoted total; there is no separate customer-facing platform fee (a historical dual 7.5%+7.5% fee model was removed and is no longer present in the code).
- **Labour**: always included in both the commission base and the tax/self-billing base.
- **Materials**: included in the commission base **unconditionally**, regardless of `Quote.materialsStrategy`. In the separate tax/self-billing calculation, materials are included only when `materialsStrategy === "PROFESSIONAL_SUPPLIED"`, and are **excluded entirely** when `materialsStrategy === "CUSTOMER_PURCHASED"`.
- **Materials discrepancy (confirmed in current code, re-verified for this package — see §16)**: the live commission engine (`CommissionCalculationService` / `CalculateJobCommissionBreakdownUseCase`) and the tax/self-billing engine (`MaestroYaTaxCalculationService` / `CalculateJobTaxBreakdownUseCase`) use the same underlying `QuoteItem` data but disagree on whether customer-purchased materials belong in the base. Both code paths carry explicit doc comments acknowledging this as a known, unresolved contradiction — not a bug that was overlooked. **This package does not decide which treatment is correct; see L-01 / B-01.**
- **Two distinct materials categories (see L-15)**: separately from the L-01 code-level discrepancy above, MaestroYa's *intended* business model draws a sharp line between (a) professional-supplied materials, which are part of the MaestroYa job/quote financial value and flow through MaestroYa's commission and payment rails, and (b) customer-purchased materials, which the professional only specifies/recommends so the customer can buy them independently from a third-party supplier, entirely outside MaestroYa's payment flow. **This is stated here as MaestroYa's intended business model, not as a confirmed legal or tax conclusion — see L-15 for the questions this intent still needs a Spanish abogado/gestor to confirm.**
- **Platform commission vs. affiliate earnings**: these are two separate, non-overlapping calculations. The professional's commission (§ above) is charged against the job total. The affiliate's earnings (§8 of Module 115; see L-08/L-09) are a percentage of MaestroYa's own net profit on the transaction (commission minus attributable costs, e.g. Stripe fees), paid by MaestroYa to a third-party affiliate/partner, and have no tax, invoicing, or withholding logic implemented for them today.

---

# 4. LEGAL / TAX QUESTIONS

### L-01 — Commission base for CUSTOMER_PURCHASED materials

**Priority:** Launch Blocker

**Advisor:** Asesor Fiscal / Gestor (base determination) + Abogado (contractual characterization)

**Current MaestroYa behavior:**
The live commission calculation (`CalculateJobCommissionBreakdownUseCase` → `commission-calculation-service.ts`) sums every `QuoteItem` with `category === "MATERIALS"` into the commission base regardless of `Quote.materialsStrategy`. The separate tax/self-billing calculation (`CalculateJobTaxBreakdownUseCase` → `maestroya-tax-calculation-service.ts`) includes materials in the taxable base, commission base, and professional net base only when `materialsStrategy === "PROFESSIONAL_SUPPLIED"`, and excludes them entirely when `materialsStrategy === "CUSTOMER_PURCHASED"`. Both paths are independently correct implementations of two different rules that were never reconciled; this is documented in-code as a known contradiction, confirmed still present as of this package's own re-reading of both files.

**Why we need confirmation:**
This directly affects every professional's payout amount and every tax figure appearing on a self-billed invoice for any job with customer-purchased materials. Commissions have already been recorded live under the materials-inclusive path while tax documents would be computed on a materials-exclusive base for the same job.

**Exact question for the advisor:**
Cuando `Quote.materialsStrategy` es `CUSTOMER_PURCHASED` (el cliente compra los materiales directamente y el profesional solo factura mano de obra), ¿debe MaestroYa incluir el valor de esos materiales en la base de cálculo de su comisión (10%) y en la base imponible de la autofactura del profesional, o deben excluirse de ambas bases por no constituir ingreso ni actividad facturable del profesional ni de MaestroYa?

**Required decision:**
A) Include CUSTOMER_PURCHASED materials in both the commission base and the tax base (align tax engine to commission engine), or
B) Exclude CUSTOMER_PURCHASED materials from both (align commission engine to tax engine), or
C) A different treatment specified by the advisor.
Also required: whether commissions already recorded under the current materials-inclusive live path need retroactive correction.

**Note — relationship to L-15:** This item (L-01) documents the *code-level* discrepancy between two calculations that already exist and already disagree. L-15 (below) separately asks the advisor to confirm MaestroYa's *intended* business model for customer-purchased materials (that they sit entirely outside the MaestroYa transaction and should not be commissioned at all). L-01's option (B) above is the option consistent with that intended model; L-01 remains open here because the advisor's confirmation, not this package, is what settles it — see L-15 for the full framing.

**Engineering impact:** Commission calculation service (`commission-calculation-service.ts`), commission breakdown use case, tax breakdown use case, potentially a backfill/correction script for already-recorded commissions and issued self-billed invoices, financial ledger entries, professional earnings reporting.

---

### L-02 — IVA treatment of MaestroYa's own commission

**Priority:** Launch Blocker

**Advisor:** Asesor Fiscal / Gestor

**Current MaestroYa behavior:**
The commission is deducted directly from the professional's payout. No separate IVA line item is modeled for the commission itself as a distinct taxable supply from MaestroYa to the professional; `maestroya-tax-calculation-service.ts` computes the customer's IVA and the professional's own IVA on their self-billed invoice, but does not compute a separate VAT figure on MaestroYa's commission as MaestroYa's own output tax.

**Why we need confirmation:**
Determines whether MaestroYa is under- or over-stating its own VAT liability on commission income.

**Exact question for the advisor:**
¿Constituye la comisión que MaestroYa retiene sobre cada trabajo (10% de mano de obra + materiales) una prestación de servicios de intermediación sujeta a IVA repercutible por MaestroYa al profesional, y en caso afirmativo, a qué tipo impositivo y sobre qué base debe calcularse dicho IVA?

**Required decision:** Whether the commission is a separate VAT-taxable supply; if so, applicable rate and calculation base; whether/how it must appear as a distinct line item on any document.

**Engineering impact:** Tax calculation service, invoice/self-billing document fields, financial ledger, MaestroYa's own accounting/VAT reporting output (if any exists — not located in this repository).

---

### L-03 — IRPF withholding rate (currently 0%)

**Priority:** Launch Blocker

**Advisor:** Asesor Fiscal / Gestor

**Current MaestroYa behavior:**
`CURRENT_IRPF_WITHHOLDING_RATE_BPS = 0` in `maestroya-tax-calculation-service.ts` — MaestroYa withholds 0% IRPF from professionals under the current intermediary model. The code comment attributes this to "direct guidance from Agencia Tributaria relayed in the Module 78 spec," but no evidence of that guidance (letter, consulta vinculante, or advisor correspondence) exists in the repository — it is an unevidenced code comment, not a documented professional confirmation. Confirmed unchanged in current code.

**Why we need confirmation:**
Incorrect IRPF withholding is a compliance failure for both MaestroYa (as potential withholding agent) and the professional. The rate may also need to differ between autónomos and S.L. professionals.

**Exact question for the advisor:**
¿Está MaestroYa obligada a practicar retención de IRPF sobre los pagos realizados a los profesionales autónomos en el marco de este modelo de intermediación (autofacturación con comisión de plataforma), o es correcto aplicar un 0% de retención? ¿Difiere esta conclusión para profesionales que operan como sociedad limitada (S.L.)?

**Required decision:** Confirm 0% is correct and durable, or specify the applicable rate; confirm whether autónomo and S.L. professionals require different treatment.

**Engineering impact:** `CURRENT_IRPF_WITHHOLDING_RATE_BPS` constant, tax calculation service, self-billed invoice fields, professional payout net calculation if a nonzero rate applies.

---

### L-04 — Comunidad de Propietarios reduced IVA rate rule

**Priority:** Launch Blocker

**Advisor:** Asesor Fiscal / Gestor (rule correctness) + Abogado (process/governance over the flag)

**Current MaestroYa behavior:**
`spain-community-iva-classification-policy.ts` applies a reduced 10% IVA rate to `COMMUNITY_OF_OWNERS` customers on qualifying renovation/repair work, gated by a materials-to-total ratio ceiling of 40% (`COMMUNITY_REDUCED_RATE_MAX_MATERIALS_RATIO = 0.4`). Every quote reaching the reduced-rate outcome sets `requiresLegalConfirmation: true` (persisted as `Quote.taxRequiresLegalConfirmation`). Re-verified: this flag is written but no downstream consumer (review queue, dashboard, blocking gate) was found in the searched application code — it is recorded, not acted upon.

**Why we need confirmation:**
A wrong classification is a live tax-rate error charged and remitted on every affected invoice, not a theoretical risk.

**Exact question for the advisor:**
¿Es correcta la aplicación del tipo reducido de IVA (10%) a los trabajos de reforma/reparación para Comunidades de Propietarios cuando el coste de materiales no supera el 40% de la base imponible, conforme a los criterios vigentes de la AEAT? ¿Debe MaestroYa implementar algún proceso de revisión o confirmación manual antes de emitir una factura al tipo reducido?

**Required decision:** Confirm the 40% materials-ratio ceiling and qualifying-work definition match current AEAT criteria, or specify corrections; decide what process (if any) must consume the persisted `taxRequiresLegalConfirmation` flag before an affected invoice is issued.

**Engineering impact:** `spain-community-iva-classification-policy.ts`, quote creation/tax calculation flow, potential new admin review queue or blocking gate wired to `taxRequiresLegalConfirmation`.

---

### L-05 — Self-billing (autofacturación) legal validity

**Priority:** Launch Blocker

**Advisor:** Abogado

**Current MaestroYa behavior:**
Self-billing authorization is a fully functional status machine (`ACTIVE`/revoked states, grant/revoke use cases, admin-initiated and self-service paths). The "agreement" a professional accepts is represented only by a version-label constant, `CURRENT_SELF_BILLING_AGREEMENT_VERSION = "self-billing-agreement-es-v1"`. Re-verified directly: the file's own doc comment states plainly this is "NOT the legal agreement text" and that no such text is drafted, stored, or rendered anywhere in the codebase.

**Why we need confirmation:**
Self-billing (autofacturación) without a legally valid authorization is an invoicing-validity and audit risk under Spanish invoicing regulation.

**Exact question for the advisor:**
¿Es válido el modelo de autofacturación actual de MaestroYa (MaestroYa emite la factura en nombre y por cuenta del profesional, bajo una autorización cuyo texto legal aún no ha sido redactado) conforme al RD 1619/2012 y normativa aplicable? ¿Qué contenido mínimo debe incluir el texto de dicha autorización para ser válido?

**Required decision:** Provide the actual authorization/agreement text required for valid autofacturación; confirm whether the current status-machine mechanism (grant/revoke, versioning) is sufficient to support it.

**Engineering impact:** A new content field/store for the agreement text (currently only a version label exists), self-billing authorization grant flow (display/acceptance of the real text), no core calculation logic change expected.

---

### L-06 — Invoice issuer tax ID

**Priority:** Launch Blocker

**Advisor:** Gestor (confirm identity/CIF) — primarily an operational item, not a legal question requiring analysis

**Current MaestroYa behavior:**
`MAESTROYA_ISSUER_TAX_ID` resolves to the hardcoded placeholder `PENDING-CIF-CONFIRMATION` when the environment variable is unset. Re-verified: this variable is not present in `.env.example` or any inspected environment file. `isPlaceholderIssuerTaxId()` exists specifically to let invoice issuance refuse to proceed while this remains a placeholder (this package did not re-trace whether that refusal is unconditionally enforced at every issuance call site).

**Why we need confirmation:**
An invoice or self-billed document carrying a placeholder tax ID is not a valid tax document; this blocks any real production invoicing.

**Exact question for the advisor:**
Confirmar el nombre legal exacto y el NIF/CIF de la entidad que debe figurar como emisor en las autofacturas y recibos emitidos por MaestroYa.

**Required decision:** MaestroYa's real legal name and NIF/CIF for production configuration.

**Engineering impact:** Set `MAESTROYA_ISSUER_LEGAL_NAME` / `MAESTROYA_ISSUER_TAX_ID` in production environment configuration (operational, not a code change); confirm the `IssuerTaxIdNotConfiguredError`/placeholder guard is wired into every invoice-issuance call site before launch.

---

### L-07 — Business-registration document taxonomy

**Priority:** Launch Blocker

**Advisor:** Gestor

**Current MaestroYa behavior:**
Only a single generic `VerificationDocumentType` value, `BUSINESS_REGISTRATION`, exists and is accepted at verification. Re-verified directly in `professional-verification-rules.ts`: the code comment reads "GESTOR DECISION PENDING: the exact accepted business-registration document type(s)... have not been specified by the business/legal owner." An admin manually reviews whatever file is uploaded; the system does not itself validate that the uploaded document proves autónomo or S.L. status.

**Why we need confirmation:**
Determines whether professionals marked "verified" are lawfully registered as they claim to be.

**Exact question for the advisor:**
¿Qué documento(s) concreto(s) (por ejemplo, Modelo 036/037, alta de autónomo en la Seguridad Social, certificado de situación censal, IAE) deben exigirse para acreditar que un profesional está legalmente dado de alta como autónomo, y qué documentación equivalente se exige para una S.L.?

**Required decision:** Specific, enumerated list of accepted document types per professional category (autónomo vs. S.L.).

**Engineering impact:** `BUSINESS_REGISTRATION_DOCUMENT_TYPES` array and `VerificationDocumentType` enum (adding specific types), verification UI copy/upload prompts, admin review checklist — a configuration/data-modeling change, not a rewrite of the verification engine.

---

### L-08 — Affiliate earnings tax/invoicing treatment

**Priority:** Pre-Launch

**Advisor:** Asesor Fiscal / Gestor

**Current MaestroYa behavior:**
Affiliate earnings (`affiliate-commission-policy.ts`) are computed as 10% of MaestroYa's net profit on a booking, with no tax ID, withholding, or invoicing-obligation logic anywhere in the codebase, and no field distinguishing an individual affiliate from a business (autónomo/S.L.) affiliate.

**Why we need confirmation:**
Affects every affiliate payout; wrong treatment is a recurring, not one-off, compliance gap.

**Exact question for the advisor:**
¿Debe el afiliado emitir su propia factura a MaestroYa por las comisiones percibidas, o resulta aplicable un mecanismo de autofacturación equivalente al de los profesionales? ¿Existe obligación de retención (IRPF u otra) sobre estos pagos? ¿Debe MaestroYa distinguir entre afiliados particulares y afiliados que actúan como autónomo o sociedad a efectos fiscales o documentales?

**Required decision:** Whether affiliates must invoice MaestroYa or MaestroYa can self-bill them; applicable withholding, if any; documentation requirements distinguishing individual vs. business affiliates.

**Engineering impact:** New tax-ID/withholding/invoicing fields and logic for `Partner`/affiliate entities (none exist today), affiliate payout use case, possibly a new self-billing-style flow for affiliates.

---

### L-09 — Affiliates outside Spain/EU

**Priority:** Pre-Launch

**Advisor:** Abogado + Asesor Fiscal / Gestor

**Current MaestroYa behavior:**
No country field exists on the affiliate/partner repository interfaces inspected; there is no mechanism to identify, restrict, or apply different tax treatment to an affiliate located outside Spain or the EU.

**Why we need confirmation:**
Cross-border payouts carry different withholding/reporting obligations than domestic ones; the platform currently cannot even identify which affiliates these rules would apply to.

**Exact question for the advisor:**
¿Puede MaestroYa admitir afiliados residentes fuera de España o de la UE en el programa de afiliación? En caso afirmativo, ¿qué obligaciones de retención, información o documentación adicionales se generan frente a afiliados no residentes en España/UE?

**Required decision:** Whether non-Spain/non-EU affiliates are permitted at all; if so, the specific tax/reporting treatment required.

**Engineering impact:** New country/residency field on `Partner`, geography-based validation at partner registration, possibly conditional withholding logic once L-08/L-09 are both answered.

---

### L-10 — Retention period for financial/audit/consent/affiliate records

**Priority:** Pre-Launch

**Advisor:** Abogado + Asesor Fiscal / Gestor

**Current MaestroYa behavior:**
`gdpr-privacy-rules.ts` classifies `MARKETPLACE_FINANCIAL`, `DISPUTES_AND_SUPPORT`, `AUDIT_LOG`, `CONSENT_RECORDS`, and `AFFILIATE_FINANCIAL` as `RETAIN`. Re-verified directly: no time-boxed retention period is encoded for any `RETAIN` category anywhere in the codebase; `ExecuteAccountErasureUseCase` never touches `RETAIN` categories, so by construction these records are retained indefinitely today. The only "retention days" concept in the codebase (`BACKUP_RETENTION_DAYS`, default 30) governs infrastructure database backups, not these legal/financial categories.

**Why we need confirmation:**
Both under-retention (destroying records needed for tax defense before the statutory period ends) and over-retention (a GDPR data-minimization violation) are live risks with no encoded period today.

**Exact question for the advisor:**
¿Cuál es el plazo mínimo y máximo de conservación exigido por la normativa mercantil, fiscal y de protección de datos española para los registros financieros de trabajos/pagos/comisiones, los registros de auditoría, los registros de consentimiento y los registros financieros de afiliados? ¿Debe MaestroYa purgar automáticamente estos datos transcurrido dicho plazo?

**Required decision:** Specific minimum and maximum retention periods per category (`MARKETPLACE_FINANCIAL`, `DISPUTES_AND_SUPPORT`, `AUDIT_LOG`, `CONSENT_RECORDS`, `AFFILIATE_FINANCIAL`); whether an automated purge after the maximum is required.

**Engineering impact:** New retention-period configuration per GDPR category, a scheduled purge job (none currently exists for these categories), `gdpr-privacy-rules.ts` classification logic extension.

---

### L-11 — Verification document retention on account deletion

**Priority:** Pre-Launch

**Advisor:** Abogado

**Current MaestroYa behavior:**
`VERIFICATION_DOCUMENTS` is classified `HARD_DELETE` and is purged immediately (including from Cloudinary, with a retry mechanism) upon account erasure, with no legal-hold exception encoded for documents tied to an unresolved dispute or investigation.

**Why we need confirmation:**
Immediate, unconditional deletion could destroy evidence needed for an active dispute or investigation involving that professional.

**Exact question for the advisor:**
¿Es adecuado el borrado inmediato e incondicional de los documentos de verificación al eliminarse una cuenta, o existe alguna obligación de conservación (por ejemplo, en el marco de KYC/prevención de fraude o de un litigio/investigación en curso) que exija una excepción de retención (legal hold) antes del borrado?

**Required decision:** Whether immediate hard-delete is acceptable as-is, or a legal-hold exception is required before erasure for documents tied to an open dispute/investigation.

**Engineering impact:** `gdpr-privacy-rules.ts` (`VERIFICATION_DOCUMENTS` strategy), `ExecuteAccountErasureUseCase`, possible new check against open disputes before allowing document purge.

---

### L-12 — Marketplace/intermediary legal characterization

**Priority:** Pre-Launch

**Advisor:** Abogado

**Current MaestroYa behavior:**
MaestroYa operates as the named issuer of record for both professional self-billed invoices and customer receipts, controls payout timing, and resolves disputes with binding financial outcomes (`ResolveDisputeWithFinancialOutcomeUseCase`). No file in the codebase encodes or references marketplace/intermediary legal status, platform liability limits, or liability allocation as an explicit legal position — these are operational assumptions embedded in code structure, not stated legal conclusions.

**Why we need confirmation:**
Misalignment between MaestroYa's operational posture and its intended legal characterization could shift liability exposure onto MaestroYa that the business model did not intend to accept.

**Exact question for the advisor:**
¿Es la actual actuación operativa de MaestroYa (emisora de facturas por cuenta de terceros, controladora del momento de pago a profesionales, resolutora vinculante de disputas) coherente con una caracterización legal de mero intermediario/plataforma de marketplace, o genera un riesgo de que se le atribuya una responsabilidad más propia de un prestador directo del servicio?

**Required decision:** Confirmation (or required adjustment) of MaestroYa's legal characterization as marketplace intermediary versus direct service provider, and any resulting change to Terms of Service or operational practice.

**Engineering impact:** Potentially none directly in application code; may require changes to Terms of Service / professional agreement text (outside this repository) and, depending on the answer, adjustments to dispute-resolution or invoicing-issuer-of-record logic.

---

### L-13 — Private-customer renovation reduced IVA rate

**Priority:** Post-Launch

**Advisor:** Asesor Fiscal / Gestor

**Current MaestroYa behavior:**
The reduced-rate IVA classification (`spain-community-iva-classification-policy.ts`) applies only to `COMMUNITY_OF_OWNERS` customers. The same file's doc comment explicitly notes that `PRIVATE_CUSTOMER`/`COMPANY` customers may separately qualify for renovation-work reduced rates under Spanish law, but this is out of scope and not implemented — private-customer renovation work is always taxed at whatever rate would otherwise apply (typically 21%).

**Why we need confirmation:**
Either a missed legal reduced-rate opportunity for customers, or confirmation that the current scope limitation is correct.

**Exact question for the advisor:**
¿Puede aplicarse el tipo reducido de IVA a trabajos de reforma/reparación de vivienda realizados para clientes particulares (no Comunidades de Propietarios), y en su caso, bajo qué requisitos (antigüedad de la vivienda, ratio de materiales, tipo de obra)?

**Required decision:** Whether to extend reduced-rate eligibility to private-customer renovation work, and under what conditions.

**Engineering impact:** `spain-community-iva-classification-policy.ts` (new classification branch for `PRIVATE_CUSTOMER`), quote/tax calculation flow — deferred to post-launch per Module 115's classification.

---

### L-14 — Self-billed invoice delivery requirement

**Priority:** Pre-Launch

**Advisor:** Abogado

**Current MaestroYa behavior:**
Self-billed invoices and customer receipts are made available for in-app retrieval (`get-professional-invoice.use-case.ts`, `get-customer-receipt.use-case.ts`). No dedicated affirmative-delivery mechanism (e.g., email) was located in the searched application source; if one exists elsewhere it was not found under the paths searched.

**Why we need confirmation:**
Some invoicing regimes require affirmative delivery to the counterparty, not merely availability for retrieval — the distinction determines whether current in-app-only access is sufficient.

**Exact question for the advisor:**
¿Es suficiente, conforme a la normativa de facturación aplicable, que la autofactura y el recibo estén disponibles para su consulta dentro de la aplicación, o es necesario un envío/entrega activa (por ejemplo, por correo electrónico) al profesional y al cliente respectivamente?

**Required decision:** Whether affirmative delivery (e.g., email) is legally required in addition to in-app availability, and if so, to whom and within what timeframe.

**Engineering impact:** Possible new email/notification delivery flow for invoices/receipts (none currently confirmed to exist), invoice/receipt issuance use cases.

---

### L-15 — Customer-Purchased Materials: Commission and IVA Treatment

**Priority:** Launch Blocker

**Advisor:** Both (Abogado + Asesor Fiscal / Gestor)

**Current MaestroYa behavior:**
As documented in L-01, the live commission engine currently sums *all* `MATERIALS`-category `QuoteItem`s into the commission base regardless of `Quote.materialsStrategy`, while the separate tax/self-billing engine already excludes materials from the base whenever `materialsStrategy === "CUSTOMER_PURCHASED"`. This item (L-15) is distinct from L-01: L-01 documents the existing code-level disagreement between two calculations; L-15 states MaestroYa's *intended* business model for this category of materials and asks the advisor to confirm whether that intent is legally sound, separately from how the code happens to behave today.

**A. MaestroYa's intended business model (stated here as intent only — NOT a confirmed legal or tax conclusion):**

MaestroYa draws a distinction between two categories of materials that a professional may list in a presupuesto:

- **Professional-supplied / MaestroYa-transaction materials** — materials the professional includes as part of the financial presupuesto/job transaction handled through MaestroYa. These are part of the MaestroYa job/quote financial value, are intended to be included in the MaestroYa commission calculation (the current 10% platform commission), and their IVA/tax treatment is intended to follow whatever model is legally applicable to that transaction.
- **Customer-purchased materials** — materials the professional only specifies or recommends in the presupuesto so that the customer can purchase them independently from a third-party supplier. Under MaestroYa's intended model: the customer pays the third-party supplier directly; MaestroYa never receives that payment; MaestroYa does not sell, invoice, or take title to those materials; the professional does not receive payment for those materials through MaestroYa. MaestroYa's intent is that these materials sit entirely outside the MaestroYa financial transaction flow — they should not generate MaestroYa commission, should not be included in the MaestroYa commission base, and the customer's purchase of them is a separate transaction between the customer and the third-party supplier, unconnected to MaestroYa.

**B. What the Spanish abogado/gestor must confirm (open questions — not yet answered):**

Whether the intent described in (A) is legally sound, and what MaestroYa must do technically and procedurally to implement it correctly, is not decided by this package. The following questions require confirmation:

**Exact questions for the advisor:**

1. Si un profesional recoge en un presupuesto materiales únicamente a título informativo, para que el cliente los adquiera de forma independiente a un proveedor tercero, y MaestroYa ni recibe el pago de esos materiales ni los vende ni los factura, ¿pueden dichos materiales considerarse legalmente ajenos al valor de la transacción de MaestroYa y, por tanto, excluirse de la base de cálculo de la comisión de la plataforma?
2. Respecto de los materiales adquiridos directamente por el cliente a un proveedor tercero, ¿tiene MaestroYa alguna obligación en materia de IVA en relación con dichos materiales cuando MaestroYa no es el vendedor, no cobra el importe ni emite factura por ellos?
3. Al determinar el tratamiento de IVA aplicable al servicio/mano de obra del profesional, ¿cómo deben tratarse los materiales adquiridos por el cliente de forma independiente? En particular, ¿deben excluirse dichos materiales de la factura/autofactura del profesional emitida a través de MaestroYa y de la base imponible de MaestroYa, conforme a la normativa española de IVA aplicable?
4. ¿El hecho de que el profesional recomiende o especifique los materiales en el presupuesto, sin cobrar por ellos ni venderlos, altera en algo el tratamiento de IVA o de comisión que resulte aplicable?
5. ¿Cuál es la representación técnica/contable correcta que MaestroYa debe implementar para que: (a) los materiales suministrados por el profesional sean comisionables cuando legalmente proceda; (b) los materiales adquiridos por el cliente queden claramente identificados como no comisionables; (c) los materiales adquiridos por el cliente no se incluyan accidentalmente en las facturas/autofacturas de MaestroYa; y (d) los materiales adquiridos por el cliente no pasen a formar parte, por error, de la base imponible de la transacción de MaestroYa?

**Required decision:**
- Confirm (or correct) that customer-purchased materials, as described in (A), may be legally treated as outside MaestroYa's transaction value and excluded from the commission base.
- Confirm MaestroYa's IVA position (or lack of one) regarding materials it never sells, invoices, or collects payment for.
- Confirm how customer-purchased materials should be treated (included or excluded) on the professional's self-billed invoice and in MaestroYa's own taxable base.
- Confirm whether the professional merely specifying/recommending the materials (without payment or sale) changes any of the above.
- Specify the correct technical/accounting representation needed so the two categories are never conflated.

**Engineering impact:** Data-model/UI distinction between the two materials categories at the point a professional builds a presupuesto (so customer-purchased items are unambiguously tagged, not inferred after the fact); commission calculation service and tax calculation service, once L-01/L-15 are resolved together; invoice/self-billing document generation (to ensure customer-purchased materials are never rendered as MaestroYa-invoiced line items); quote/job financial summary views shown to customers and professionals. No production code is changed by this package itself — this item only records what must be confirmed and, once confirmed, implemented.

---

# 5. BUSINESS DECISIONS

### B-01 — Commission/tax materials reconciliation (business side)

**Current implementation:** Two disagreeing calculations exist for CUSTOMER_PURCHASED materials (see L-01).

**Business question:** Independent of the legal/tax confirmation in L-01, which rule should MaestroYa's product actually follow going forward?

**Options currently identified:**
Option A: Commission and tax base both include CUSTOMER_PURCHASED materials value.
Option B: Commission and tax base both exclude CUSTOMER_PURCHASED materials value.

**Decision required from MaestroYa:** Which option to implement, subject to and consistent with the legal/tax answer to L-01.

**Potential technical impact:** Commission calculation service, tax calculation service, backfill of already-recorded commissions if retroactive correction is needed.

---

### B-02 — Business-registration document list

**Current implementation:** Placeholder generic `BUSINESS_REGISTRATION` document type only.

**Business question:** Once the gestor specifies the legally acceptable document types (L-07), which of those should the platform's verification UI actually accept and require?

**Options currently identified:**
Option A: Accept the full legally-acceptable list the gestor names.
Option B: Accept a narrower subset for a simpler onboarding flow, if the gestor confirms a subset is still legally sufficient.

**Decision required from MaestroYa:** The specific accepted document list to configure in the verification UI/document-type enum.

**Potential technical impact:** `VerificationDocumentType` enum, `BUSINESS_REGISTRATION_DOCUMENT_TYPES` array, verification UI copy.

---

### B-03 — Mandatory insurance/licensing by service category

**Current implementation:** `INSURANCE_CERTIFICATE` and `PROFESSIONAL_CERTIFICATION` document types exist and can be uploaded, but no rule makes either mandatory for any service category.

**Business question:** Should certain service categories (e.g., electrical, gas, plumbing) require insurance or a professional license/certification before activation?

**Options currently identified:**
Option A: Keep these documents fully optional for all categories.
Option B: Require them for specific, named service categories.

**Decision required from MaestroYa:** Whether to mandate these documents, and for which categories.

**Potential technical impact:** Service-category-to-required-document mapping, verification approval rules, onboarding UI.

---

### B-04 — Affiliate program geography

**Current implementation:** No geography restriction encoded; any affiliate can register regardless of residency.

**Business question:** Should the affiliate program be formally restricted to Spain/EU-resident affiliates until cross-border tax handling (L-09) is implemented?

**Options currently identified:**
Option A: Restrict registration to Spain/EU residents until L-09 is resolved.
Option B: Continue allowing unrestricted registration and address cross-border tax treatment retroactively.

**Decision required from MaestroYa:** Whether to restrict affiliate program geography now or accept the current exposure.

**Potential technical impact:** New residency/country field and validation at partner registration.

---

### B-05 — Affiliate payout threshold / expiry / cadence

**Current implementation:** €50 minimum accumulated payout threshold (`DEFAULT_MINIMUM_PAYOUT_THRESHOLD = 50`), 180-day pending-commission expiry (`AFFILIATE_COMMISSION_EXPIRY_DAYS = 180`), full-balance-only payout (no partial payout).

**Business question:** Are these the intended thresholds and cadence for production?

**Options currently identified:**
Option A: Keep current values (€50 / 180 days / full-balance-only).
Option B: Adjust one or more values.

**Decision required from MaestroYa:** Confirm or adjust the threshold, expiry period, and payout cadence.

**Potential technical impact:** `DEFAULT_MINIMUM_PAYOUT_THRESHOLD`, `AFFILIATE_COMMISSION_EXPIRY_DAYS` constants; per-partner override already supported via `Partner.minimumPayoutThreshold`.

---

### B-06 — Reduced-rate IVA scope (private-customer renovation)

**Current implementation:** Not implemented — only Community of Owners customers get reduced-rate treatment (see L-13).

**Business question:** Once L-13 is legally confirmed, should MaestroYa invest engineering effort to extend reduced-rate handling to private-customer renovation work?

**Options currently identified:**
Option A: Implement it once legally confirmed as applicable.
Option B: Defer indefinitely regardless of legal applicability, accepting customers are overcharged IVA where the reduced rate would otherwise apply.

**Decision required from MaestroYa:** Whether and when to implement, contingent on L-13's answer.

**Potential technical impact:** `spain-community-iva-classification-policy.ts`, quote/tax flow.

---

### B-07 — GDPR retention maximums

**Current implementation:** Indefinite retention by default for all `RETAIN`-classified categories (see L-10).

**Business question:** Once legal minimums/maximums are known (L-10), what specific target retention windows should MaestroYa configure per category?

**Options currently identified:**
Option A: Set each category's retention window to exactly the legal minimum required.
Option B: Set a uniform window across categories at the highest applicable legal minimum, for operational simplicity.

**Decision required from MaestroYa:** Target retention window per category, within the legal minimum/maximum bounds L-10 establishes.

**Potential technical impact:** New retention-period configuration and automated purge job (none exists today for these categories).

---

# 6. Questions Specifically for the Abogado

### Marketplace / contractual structure
- [L-12] Marketplace/intermediary legal characterization vs. direct-service-provider exposure.
- [L-15] Whether customer-purchased materials, as MaestroYa intends to treat them, may legally sit outside MaestroYa's transaction value (joint with Gestor — see §7).

### Self-billing / invoicing
- [L-05] Legal validity of the current autofacturación model and required authorization text.
- [L-14] Whether affirmative delivery of self-billed invoices/receipts is required beyond in-app availability.
- [L-15] Whether customer-purchased materials should be excluded from the professional's self-billed invoice (joint with Gestor).

### Professional verification
- [L-07] Business-registration document taxonomy (joint with Gestor — see §7).

### GDPR / document retention
- [L-10] Minimum/maximum retention periods for financial/audit/consent/affiliate records (joint with Gestor).
- [L-11] Legal-hold exception for verification documents tied to an open dispute/investigation before erasure.

### Affiliate program
- [L-09] Whether non-Spain/non-EU affiliates may be admitted and what obligations follow.

### Liability / marketplace characterization
- [L-12] See "Marketplace / contractual structure" above (same item).

### Other legal matters
- (none beyond the above)

---

# 7. Questions Specifically for the Asesor Fiscal / Gestor

- [L-01] Commission base for CUSTOMER_PURCHASED materials (joint with the contractual angle for Abogado).
- [L-15] Commission and IVA treatment of customer-purchased materials under MaestroYa's intended business model (joint with Abogado).
- [L-02] IVA treatment of MaestroYa's own commission as a taxable supply.
- [L-03] IRPF withholding rate — confirm 0% or specify correct rate, autónomo vs. S.L.
- [L-04] Comunidad de Propietarios reduced-rate IVA rule correctness and governance of the persisted confirmation flag.
- [L-06] MaestroYa's real legal name and NIF/CIF for invoice issuer configuration.
- [L-07] Business-registration document taxonomy (joint with Abogado).
- [L-08] Affiliate earnings invoicing/self-billing mechanism and withholding.
- [L-09] Cross-border affiliate tax/reporting obligations (joint with Abogado).
- [L-10] Retention periods for financial/audit/consent/affiliate records (joint with Abogado).
- [L-13] Private-customer renovation reduced IVA rate eligibility.

---

# 8. Launch Blockers

| ID | Topic | Advisor | Why it blocks launch | Decision required |
|---|---|---|---|---|
| L-01 / B-01 | Commission base for CUSTOMER_PURCHASED materials | Gestor + Abogado | Two disagreeing live calculations directly affect every professional payout and every tax figure | Which base is correct; retroactive correction scope |
| L-02 | IVA on MaestroYa's own commission | Gestor | Determines whether MaestroYa under/over-states its own VAT liability | Confirm VAT treatment of commission income |
| L-03 | IRPF withholding = 0% | Gestor | Wrong withholding is a compliance failure for MaestroYa and the professional | Confirm durability of 0% rate, or specify correct rate |
| L-04 | Comunidad de Propietarios reduced IVA rule | Gestor + Abogado | A live tax-rate error on every affected invoice if the rule is wrong | Confirm the rule; define process for the persisted confirmation flag |
| L-05 | Self-billing legal validity/text | Abogado | Invoices could be legally invalid without a valid authorization | Supply and confirm real authorization text |
| L-06 | Invoice issuer tax ID | Gestor (confirm) + Owner (configure) | An invoice with a placeholder tax ID is not a valid tax document | Supply MaestroYa's real CIF/legal name |
| L-07 / B-02 | Business-registration document taxonomy | Gestor | "Verified" professionals may not actually be lawfully registered | Specify accepted document list |
| L-15 | Customer-purchased materials: commission and IVA treatment | Abogado + Gestor | Directly determines whether customer-purchased materials may legally be excluded from MaestroYa's commission base and taxable base, as the intended business model assumes — without confirmation the platform cannot rely on this exclusion | Confirm whether customer-purchased materials sit outside MaestroYa's transaction value; confirm resulting IVA/invoicing treatment |

---

# 9. Pre-Launch Questions

| ID | Topic |
|---|---|
| L-08 | Affiliate earnings tax/invoicing treatment |
| L-09 | Non-Spain/EU affiliates |
| L-10 | Financial/audit/consent/affiliate retention periods |
| L-11 | Verification document retention on erasure (legal hold) |
| L-12 | Marketplace/intermediary legal characterization |
| L-14 | Self-billed invoice delivery requirement |

This matches Module 115's own pre-launch categorization; no reclassification was found necessary on re-verification of current code.

---

# 10. Post-Launch Questions

| ID | Topic |
|---|---|
| L-13 | Private-customer renovation reduced IVA rate |

---

# 11. Required Answers Format

To make it possible to convert the advisor's answers directly into engineering requirements (feeding Module 117), MaestroYa requests each answer in the following form:

```
Question ID:
L-XX

Conclusion:
[Advisor's conclusion]

Applicable rule / legal basis:
[Advisor fills this]

Conditions:
[Advisor fills this]

Required documentation:
[Advisor fills this]

Effective scope:
[Advisor fills this]

Implementation recommendation:
[Advisor fills this]
```

---

# 12. Engineering Decision Matrix

| Question | Legal/Tax Answer Required | Potential Code Area | Potential DB Change | Tests Required |
|---|---|---|---|---|
| L-01 / B-01 | Which materials base is correct | `commission-calculation-service.ts`, `maestroya-tax-calculation-service.ts`, breakdown use cases | Possibly a backfill/correction migration for recorded `Commission` rows | Unit tests for both services; regression tests for already-issued invoices |
| L-02 | Is commission a separate VAT supply | Tax calculation service, invoice document fields | Unknown — depends on legal answer | Tax calculation unit tests |
| L-03 | Correct IRPF rate | `CURRENT_IRPF_WITHHOLDING_RATE_BPS`, tax calculation service | None expected | Tax calculation unit tests |
| L-04 | Community IVA rule correctness + flag governance | `spain-community-iva-classification-policy.ts`, new admin review flow | Possibly a review-queue table/status | Policy unit tests; new review-flow integration tests |
| L-05 | Valid autofacturación authorization text | Self-billing authorization grant flow, new content store | New table/field for agreement text (currently only a version label exists) | Authorization acceptance flow tests |
| L-06 | Real CIF/legal name | Environment configuration only | None | Invoice issuance smoke test with real values |
| L-07 / B-02 | Accepted document list | `VerificationDocumentType` enum, `BUSINESS_REGISTRATION_DOCUMENT_TYPES` | Possibly enum/reference-table change | Verification rules unit tests |
| L-08 | Affiliate invoicing/withholding mechanism | New affiliate tax/invoicing logic | New fields on `Partner`/`AffiliateCommission` | New unit + integration tests |
| L-09 | Cross-border affiliate policy | Partner registration validation | New country/residency field | Registration validation tests |
| L-10 | Retention periods | `gdpr-privacy-rules.ts`, new purge job | New retention-period config | Purge job unit + scheduled-job tests |
| L-11 | Legal-hold exception | `gdpr-privacy-rules.ts`, `ExecuteAccountErasureUseCase` | Possibly a dispute-open check before purge | Erasure use case tests |
| L-12 | Marketplace characterization | Unknown — likely ToS/contract only | None expected | N/A (legal document, not code) |
| L-13 | Private-customer reduced IVA scope | `spain-community-iva-classification-policy.ts` | None expected | Policy unit tests |
| L-14 | Delivery requirement | New delivery/notification flow (if required) | Possibly a delivery-log table | New delivery flow tests |
| L-15 | Whether customer-purchased materials are legally outside MaestroYa's transaction value; resulting IVA/invoicing treatment | `commission-calculation-service.ts`, `calculate-job-commission-breakdown.use-case.ts`, `maestroya-tax-calculation-service.ts`, presupuesto/quote-building UI (tagging of materials category), invoice/self-billing document generation | Possibly a clearer/enforced `materialsStrategy` distinction at the `QuoteItem` level (data-modeling change, not a new table) | Commission and tax calculation unit tests; invoice-generation tests confirming customer-purchased materials never appear as MaestroYa-invoiced line items |

---

# 13. Documents / Information to Request from Advisor

- [ ] Written legal conclusion for each L-01 through L-15 item, in the format specified in §11.
- [ ] Applicable legal basis / rule citation for each conclusion.
- [ ] Confirmed IVA and IRPF treatment (rates, bases, conditions).
- [ ] Required contractual clauses for the self-billing authorization (L-05).
- [ ] Required exact wording/content for self-billed invoices and customer receipts (L-05, L-14, L-15).
- [ ] Required documentation list for professional business-registration verification (L-07).
- [ ] Confirmed retention periods (minimum and maximum) per GDPR data category (L-10).
- [ ] Affiliate tax/invoicing treatment, including individual vs. business and domestic vs. cross-border distinctions (L-08, L-09).
- [ ] Marketplace/platform liability position and any recommended adjustment to Terms of Service (L-12).
- [ ] Any required registrations, licenses, or regulatory filings not currently identified in this package.

Do not assert that any particular document is legally mandatory unless the advisor confirms it.

---

# 14. Final Decision Checklist

**LEGAL/TAX CONFIRMATION** (abogado/gestor to confirm):

- [ ] L-01 resolved
- [ ] L-02 resolved
- [ ] L-03 resolved
- [ ] L-04 resolved
- [ ] L-05 resolved
- [ ] L-06 resolved
- [ ] L-07 resolved
- [ ] L-08 resolved
- [ ] L-09 resolved
- [ ] L-10 resolved
- [ ] L-11 resolved
- [ ] L-12 resolved
- [ ] L-13 resolved
- [ ] L-14 resolved
- [ ] L-15 resolved

**BUSINESS DECISION** (MaestroYa owner to decide, most contingent on the legal/tax answers above):

- [ ] B-01 decided
- [ ] B-02 decided
- [ ] B-03 decided
- [ ] B-04 decided
- [ ] B-05 decided
- [ ] B-06 decided
- [ ] B-07 decided

**ENGINEERING IMPLEMENTATION** (a later module, only after the above):

- [ ] Not started — see §15.

---

# 15. Module 117 Input Requirements

Module 117 should NOT start merely because Module 116 exists. It should start only after the applicable professional answers and business decisions above are available.

Expected input to Module 117:

1. Advisor answers, in the format specified in §11, for every L-01 through L-15 item that has been resolved.
2. Legal/tax basis cited by the advisor where provided.
3. Business decisions (B-01 through B-07) made by the MaestroYa owner, consistent with the legal/tax answers.
4. Required documentation (per §13's checklist), collected.
5. Required contractual changes (self-billing authorization text, Terms of Service adjustments) as supplied by the abogado.
6. Required tax/invoice treatment (rates, bases, withholding) as supplied by the gestor.
7. Required engineering consequences, translated from §12's Engineering Decision Matrix once each "Unknown — depends on legal answer" cell has an actual answer.

Module 117 can then translate these into concrete implementation tasks.

---

## 16. Verification Log — Current Code vs. Module 115

Before writing this package, the following Module 115 claims were independently re-verified against current source code in this repository (branch `feature/module-116-legal-consultation-decision-package`), per this module's instructions. **No factual discrepancy was found; every claim below is confirmed accurate as of current code:**

| Claim | File(s) checked | Result |
|---|---|---|
| Commission base includes all materials regardless of `materialsStrategy` | `src/core/domain/services/commission-calculation-service.ts`, `src/core/application/use-cases/financial/calculate-job-commission-breakdown.use-case.ts` | Confirmed — code and doc comments match Module 115 verbatim |
| Tax/self-billing base excludes CUSTOMER_PURCHASED materials | `src/core/application/use-cases/financial/calculate-job-tax-breakdown.use-case.ts` | Confirmed — `materialsStrategy === "PROFESSIONAL_SUPPLIED"` gate present |
| IRPF withholding hardcoded to 0% | `src/core/domain/services/maestroya-tax-calculation-service.ts` | Confirmed — `CURRENT_IRPF_WITHHOLDING_RATE_BPS = 0` |
| Invoice issuer tax ID resolves to placeholder | `src/core/domain/services/invoicing-issuer.ts`, `.env.example` | Confirmed — `PENDING-CIF-CONFIRMATION` placeholder present; `MAESTROYA_ISSUER_TAX_ID` absent from `.env.example` |
| Self-billing agreement is a version label only, no legal text | `src/core/domain/services/self-billing-agreement.ts` | Confirmed — file contains only `CURRENT_SELF_BILLING_AGREEMENT_VERSION` constant and doc comment stating no legal text exists |
| Affiliate formula: profit-base (commission minus attributable cost), 10% rate | `src/core/domain/services/affiliate-commission-policy.ts` | Confirmed — `AFFILIATE_COMMISSION_RATE_BPS = 1000`, formula matches |
| €50 affiliate payout threshold, 180-day expiry | `src/core/domain/services/partner-payout-rules.ts`, `affiliate-commission-policy.ts` | Confirmed — `DEFAULT_MINIMUM_PAYOUT_THRESHOLD = 50`, `AFFILIATE_COMMISSION_EXPIRY_DAYS = 180` |
| GDPR categories (HARD_DELETE/ANONYMIZE/RETAIN classification) | `src/core/domain/services/gdpr-privacy-rules.ts` | Confirmed — category strategy assignments match Module 115's table |
| Community IVA 40% materials ratio ceiling; `requiresLegalConfirmation` flag persisted | `src/core/domain/services/spain-community-iva-classification-policy.ts` | Confirmed — `COMMUNITY_REDUCED_RATE_MAX_MATERIALS_RATIO = 0.4`, flag set on REDUCED outcome |
| "GESTOR DECISION PENDING" business-registration document taxonomy comment | `src/core/domain/services/professional-verification-rules.ts` | Confirmed — comment present verbatim, only generic `BUSINESS_REGISTRATION` type defined |

No stale statement was found requiring correction. This package therefore reproduces Module 115's factual descriptions of current behavior without modification, while independently re-deriving the exact-question, required-decision, and engineering-impact sections for each item.

`legal/` was not inspected, listed, staged, or relied upon at any point in preparing this package, per this module's explicit instruction.
