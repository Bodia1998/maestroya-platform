/**
 * Module 167 — Legacy Archive & Retention Export: the declarative inventory.
 *
 * This file is the single source of truth for WHAT is archived: every category, the exact fields each one may carry, why it is
 * retained, how it links to the others, and everything that is deliberately NOT archived. The Prisma reader selects exactly
 * these fields, the serializer emits exactly these fields (anything else a reader returns is dropped), and the verifier checks an
 * archive against this list — so a field that is not declared here cannot reach an archive.
 *
 * Nothing here is legal, tax or accounting advice, and no retention period is defined: D20 is unresolved (see
 * LEGACY_ARCHIVE_BLOCKERS and docs/MODULE_167_LEGACY_ARCHIVE_RETENTION_EXPORT.md).
 */

export type ArchiveFieldKind = "id" | "string" | "enum" | "money" | "decimal" | "int" | "bool" | "date";

/**
 * CORE             — identifiers, statuses, timestamps, exact amounts and currencies: always archived.
 * INVOICE_CONTENT  — the legal content of an invoice / credit note (party legal names and tax ids, line descriptions, the
 *                    rectification reason). Personal data. Archived only with an explicit opt-in (decision B2).
 * NARRATIVE        — free-text explanations written by people or systems (notes, reasons, descriptions). May contain personal
 *                    data. Archived only with an explicit opt-in (decision B3).
 */
export type ArchiveTier = "CORE" | "INVOICE_CONTENT" | "NARRATIVE";

export interface ArchiveField {
  name: string;
  kind: ArchiveFieldKind;
  nullable: boolean;
  tier: ArchiveTier;
  /** Category whose id this field must resolve to inside the same archive (checked by the verifier). */
  ref?: string;
  /** Table the id points at that is NOT part of the archive (users, profiles, ...): kept only as an opaque pseudonymous id. */
  external?: string;
}

export interface ArchiveCategorySpec {
  /** File stem and stable category name. */
  key: string;
  /** Prisma delegate name (used by the reader). */
  model: string;
  table: string;
  title: string;
  evidence: "MANDATORY" | "SUPPORTING";
  why: string;
  /** Human-readable statement of how legacy scope is established. The executable filter lives in the Prisma reader. */
  scope: string;
  /** Field holding the currency of the row, or null when the row has none (totals are then tagged NO_CURRENCY_ON_RECORD). */
  currencyField: string | null;
  /** Money fields that are totalled in the manifest and cross-checked against the database. Totals are never netted or mixed. */
  totalFields: readonly string[];
  /** Composite natural key (tables with no `id` column). Default: ["id"]. */
  idFields?: readonly string[];
  fields: readonly ArchiveField[];
}

type Opts = { nullable?: true; tier?: ArchiveTier; ref?: string; external?: string };
const f = (name: string, kind: ArchiveFieldKind, o: Opts = {}): ArchiveField => ({ name, kind, nullable: o.nullable === true, tier: o.tier ?? "CORE", ...(o.ref ? { ref: o.ref } : {}), ...(o.external ? { external: o.external } : {}) });
const pk = () => f("id", "id");
const ref = (name: string, category: string, nullable = false) => f(name, "id", { ref: category, ...(nullable ? { nullable: true } : {}) });
const ext = (name: string, table: string, nullable = false) => f(name, "id", { external: table, ...(nullable ? { nullable: true } : {}) });
const str = (name: string, o: Opts = {}) => f(name, "string", o);
const en = (name: string, o: Opts = {}) => f(name, "enum", o);
const money = (name: string, o: Opts = {}) => f(name, "money", o);
const dec = (name: string) => f(name, "decimal");
const int = (name: string, o: Opts = {}) => f(name, "int", o);
const bool = (name: string) => f(name, "bool");
const date = (name: string, o: Opts = {}) => f(name, "date", o);
const text = (name: string, nullable = false) => f(name, "string", { tier: "NARRATIVE", ...(nullable ? { nullable: true } : {}) });
const invoiceText = (name: string, nullable = false) => f(name, "string", { tier: "INVOICE_CONTENT", ...(nullable ? { nullable: true } : {}) });

const N = true;

/**
 * Order: parents before children wherever the relations are acyclic. Some relations are mutually referencing (refunds, financial
 * adjustments and transactions point at each other), so order is NOT a validity requirement: references are checked after all
 * categories are loaded. Two placements are load-bearing for the reader: `affiliate_*` come after `commissions` and `audit_logs`
 * is last, because they are scoped by the ids of the categories before them.
 */
export const LEGACY_ARCHIVE_CATEGORIES: readonly ArchiveCategorySpec[] = [
  {
    key: "service_requests", model: "serviceRequest", table: "service_requests", title: "Legacy service requests", evidence: "MANDATORY",
    why: "Root of every legacy contract: the customer's request that quotes, jobs and payments hang from. Needed to trace any amount back to a request and its lifecycle.",
    scope: "flowVersion = LEGACY_QUOTE_PAYMENT (soft-deleted rows included).",
    currencyField: null, totalFields: ["budgetMin", "budgetMax"],
    fields: [pk(), ext("customerId", "customer_profiles"), ext("categoryId", "service_categories"), en("status"), en("flowVersion"), en("urgency"), money("budgetMin", { nullable: N }), money("budgetMax", { nullable: N }), date("scheduledFor", { nullable: N }), date("publishedAt", { nullable: N }), date("expiresAt", { nullable: N }), date("deletedAt", { nullable: N }), date("createdAt"), date("updatedAt"), text("title"), text("description")],
  },
  {
    key: "quotes", model: "quote", table: "quotes", title: "Legacy quotes", evidence: "MANDATORY",
    why: "The priced offer that became the contract; carries the tax breakdown the customer paid against.",
    scope: "Quote whose service request is LEGACY_QUOTE_PAYMENT.",
    currencyField: "currency", totalFields: ["totalAmount", "taxableBase", "vatAmount", "grossTotalAmount"],
    fields: [pk(), ref("serviceRequestId", "service_requests"), ext("professionalProfileId", "professional_profiles", true), ext("companyProfileId", "company_profiles", true), ext("submittedByUserId", "users"), en("status"), money("totalAmount"), str("currency"), date("validUntil", { nullable: N }), date("respondedAt", { nullable: N }), en("materialsStrategy"), en("operationType", { nullable: N }), f("isResidentialProperty", "bool", { nullable: true }), en("customerTypeAtQuote", { nullable: N }), money("taxableBase", { nullable: N }), money("taxMaterialsAmount", { nullable: N }), int("vatRateBps", { nullable: N }), money("vatAmount", { nullable: N }), money("grossTotalAmount", { nullable: N }), str("taxClassificationCode", { nullable: N }), bool("taxRequiresLegalConfirmation"), int("taxCalculationVersion", { nullable: N }), date("taxCalculatedAt", { nullable: N }), date("createdAt"), date("updatedAt"), text("notes", true)],
  },
  {
    key: "quote_items", model: "quoteItem", table: "quote_items", title: "Legacy quote line items", evidence: "MANDATORY",
    why: "Line amounts that add up to the quote total; needed to explain the quoted price.",
    scope: "Item of a quote in scope. Currency is the parent quote's (no currency column on the row).",
    currencyField: null, totalFields: ["amount"],
    fields: [pk(), ref("quoteId", "quotes"), dec("quantity"), money("unitPrice"), money("amount"), int("sortOrder"), en("category"), date("createdAt"), text("description")],
  },
  {
    key: "jobs", model: "job", table: "jobs", title: "Legacy jobs", evidence: "MANDATORY",
    why: "The authoritative lifecycle object after acceptance (requests rest at ACCEPTED); links the quote to payments, payouts and invoices.",
    scope: "Job whose service request is LEGACY_QUOTE_PAYMENT.",
    currencyField: null, totalFields: [],
    fields: [pk(), ref("serviceRequestId", "service_requests"), ref("quoteId", "quotes"), ext("customerId", "customer_profiles"), ext("professionalProfileId", "professional_profiles", true), ext("companyProfileId", "company_profiles", true), en("status"), date("startedAt", { nullable: N }), date("completedAt", { nullable: N }), date("cancelledAt", { nullable: N }), en("cancellationReason", { nullable: N }), date("createdAt"), date("updatedAt"), text("cancellationNote", true)],
  },
  {
    key: "disputes", model: "dispute", table: "disputes", title: "Legacy customer disputes", evidence: "MANDATORY",
    why: "Explains why a payment was held, adjusted or refunded; the case number is the business identifier used in support records.",
    scope: "Dispute whose service request is LEGACY_QUOTE_PAYMENT.",
    currencyField: null, totalFields: [],
    fields: [pk(), str("caseNumber"), ref("jobId", "jobs"), ref("serviceRequestId", "service_requests"), ext("raisedByUserId", "users"), ext("respondentProfessionalProfileId", "professional_profiles", true), ext("respondentCompanyProfileId", "company_profiles", true), en("reason"), en("status"), en("priority"), en("resolution", { nullable: N }), date("resolvedAt", { nullable: N }), date("closedAt", { nullable: N }), date("createdAt"), date("updatedAt"), text("title"), text("description"), text("resolutionNote", true)],
  },
  {
    key: "job_completion_confirmations", model: "jobCompletionConfirmation", table: "job_completion_confirmations", title: "Legacy completion confirmations and release decisions", evidence: "MANDATORY",
    why: "Records whether and when the customer confirmed completion and whether release of the held payment was approved, held or denied.",
    scope: "Confirmation of a job in scope.",
    currencyField: null, totalFields: [],
    fields: [pk(), ref("jobId", "jobs"), en("status"), date("professionalCompletedAt"), date("confirmationDeadlineAt"), date("confirmedAt", { nullable: N }), ref("disputeId", "disputes", true), en("releaseStatus"), date("releaseDecidedAt", { nullable: N }), date("createdAt"), date("updatedAt"), text("releaseReason")],
  },
  {
    key: "appointments", model: "appointment", table: "appointments", title: "Legacy appointments (bookings)", evidence: "SUPPORTING",
    why: "Evidence of when the service was scheduled and delivered; supports completion and dispute questions.",
    scope: "Appointment of a service request in scope. Address and notes are not archived.",
    currencyField: null, totalFields: [],
    fields: [pk(), ref("jobId", "jobs"), ref("quoteId", "quotes"), ref("serviceRequestId", "service_requests"), en("status"), date("scheduledStart", { nullable: N }), date("scheduledEnd", { nullable: N }), date("actualStart", { nullable: N }), date("actualEnd", { nullable: N }), date("cancelledAt", { nullable: N }), en("cancellationReason", { nullable: N }), ref("rescheduledFromId", "appointments", true), date("createdAt"), date("updatedAt"), text("notes", true), text("cancellationNote", true)],
  },
  {
    key: "payments", model: "payment", table: "payments", title: "Legacy customer payments", evidence: "MANDATORY",
    why: "The money MaestroYa held for the customer; the root of every refund, payout, commission, receipt and chargeback.",
    scope: "Payment whose service request is LEGACY_QUOTE_PAYMENT.",
    currencyField: "currency", totalFields: ["amount"],
    fields: [pk(), ref("serviceRequestId", "service_requests"), ref("quoteId", "quotes", true), ext("payerId", "users"), money("amount"), str("currency"), en("method"), en("status"), str("stripePaymentIntentId", { nullable: N }), date("capturedAt", { nullable: N }), date("createdAt"), date("updatedAt"), text("failureReason", true)],
  },
  {
    key: "commissions", model: "commission", table: "commissions", title: "Legacy platform commissions", evidence: "MANDATORY",
    why: "MaestroYa's revenue on each captured payment and the basis of invoice commission lines and affiliate rewards. Status stays PENDING by design (no code settles it).",
    scope: "Commission of a payment in scope. Currency is the payment's (no currency column on the row).",
    currencyField: null, totalFields: ["amount"],
    fields: [pk(), ref("paymentId", "payments"), ext("professionalProfileId", "professional_profiles", true), ext("companyProfileId", "company_profiles", true), int("rateBps"), money("amount"), en("status"), date("settledAt", { nullable: N }), date("createdAt"), date("updatedAt")],
  },
  {
    key: "payouts", model: "payout", table: "payouts", title: "Legacy professional payouts", evidence: "MANDATORY",
    why: "Money released to professionals, including reversals; required to show where each captured payment ended up.",
    scope: "All payouts: the table is legacy-only by construction (M121/M131 guard; the lead-fee flow has its own tables), as established in M166.",
    currencyField: "currency", totalFields: ["amount", "reversedAmount"],
    fields: [pk(), ext("professionalProfileId", "professional_profiles", true), ext("companyProfileId", "company_profiles", true), money("amount"), str("currency"), en("status"), str("stripeTransferId", { nullable: N }), date("periodStart", { nullable: N }), date("periodEnd", { nullable: N }), date("processedAt", { nullable: N }), ref("jobId", "jobs", true), ref("paymentId", "payments", true), int("attemptCount"), date("lastAttemptedAt", { nullable: N }), str("stripeReversalId", { nullable: N }), money("reversedAmount", { nullable: N }), date("reversedAt", { nullable: N }), date("createdAt"), date("updatedAt"), text("failureReason", true), text("reversalFailureReason", true)],
  },
  {
    key: "dispute_resolution_decisions", model: "disputeResolutionDecision", table: "dispute_resolution_decisions", title: "Legacy dispute resolution decisions", evidence: "MANDATORY",
    why: "The recorded admin decision that drove a financial adjustment; links a dispute to its money outcome.",
    scope: "Decision of a job in scope.",
    currencyField: null, totalFields: [],
    fields: [pk(), ref("disputeId", "disputes"), ref("jobId", "jobs"), ref("paymentId", "payments", true), en("resolution"), en("outcome"), en("status"), ext("decidedByUserId", "users"), date("decidedAt"), date("appliedAt", { nullable: N }), date("createdAt"), date("updatedAt"), text("reason")],
  },
  {
    key: "transactions", model: "transaction", table: "transactions", title: "Legacy ledger transactions", evidence: "MANDATORY",
    why: "The signed money ledger (positive = inflow to the platform, negative = outflow) that reconciles payments, refunds, payouts, commissions and adjustments.",
    scope: "Transaction linked to an in-scope payment, refund, commission or financial adjustment, or to any payout.",
    currencyField: "currency", totalFields: ["amount"],
    fields: [pk(), ref("paymentId", "payments", true), ref("payoutId", "payouts", true), ref("refundId", "refunds", true), ref("commissionId", "commissions", true), en("type"), en("status"), money("amount"), str("currency"), date("createdAt"), date("updatedAt"), text("description", true)],
  },
  {
    key: "refunds", model: "refund", table: "refunds", title: "Legacy refunds", evidence: "MANDATORY",
    why: "Money returned to customers; reduces the captured amount and drives credit notes and payout reversals.",
    scope: "Refund of a payment in scope. Currency is the payment's (no currency column on the row).",
    currencyField: null, totalFields: ["amount"],
    fields: [pk(), ref("paymentId", "payments"), ext("requestedByUserId", "users"), money("amount"), en("reason"), en("status"), str("stripeRefundId", { nullable: N }), date("processedAt", { nullable: N }), ref("financialAdjustmentId", "financial_adjustments", true), int("attemptCount"), date("createdAt"), date("updatedAt"), text("notes", true), text("failureReason", true)],
  },
  {
    key: "financial_adjustments", model: "financialAdjustment", table: "financial_adjustments", title: "Legacy financial adjustments", evidence: "MANDATORY",
    why: "Dispute- and chargeback-driven money corrections; the link between a decision and its ledger transaction.",
    scope: "Adjustment of a job in scope.",
    currencyField: "currency", totalFields: ["amount"],
    fields: [pk(), ref("jobId", "jobs"), ref("disputeId", "disputes", true), ref("paymentId", "payments", true), en("type"), en("status"), money("amount"), str("currency"), ext("requestedByUserId", "users"), ref("transactionId", "transactions", true), ref("resolutionDecisionId", "dispute_resolution_decisions", true), date("appliedAt", { nullable: N }), date("createdAt"), date("updatedAt"), text("reason", true)],
  },
  {
    key: "stripe_disputes", model: "stripeDispute", table: "stripe_disputes", title: "Legacy provider disputes (chargebacks)", evidence: "MANDATORY",
    why: "Card-network chargebacks against legacy payments, including lost disputes closed with no adjustment (flagged for manual reconciliation).",
    scope: "All rows: the table is legacy-only by construction, as established in M166.",
    currencyField: "currency", totalFields: ["amount"],
    fields: [pk(), str("stripeDisputeId"), str("stripeChargeId", { nullable: N }), str("stripePaymentIntentId", { nullable: N }), ref("paymentId", "payments", true), ref("jobId", "jobs", true), money("amount"), str("currency"), str("reason", { nullable: N }), en("status"), date("evidenceDueBy", { nullable: N }), ref("financialAdjustmentId", "financial_adjustments", true), date("closedAt", { nullable: N }), date("createdAt"), date("updatedAt")],
  },
  {
    key: "dispute_evidence", model: "disputeEvidence", table: "dispute_evidence", title: "Legacy dispute evidence (metadata only)", evidence: "SUPPORTING",
    why: "Shows that evidence existed and when it was filed. The files themselves are NOT archived (blocker B4); the file URL is never exported because it may grant access to the file.",
    scope: "Evidence of a dispute in scope.",
    currencyField: null, totalFields: [],
    fields: [pk(), ref("disputeId", "disputes"), ext("submittedByUserId", "users"), str("fileType", { nullable: N }), int("fileSizeBytes", { nullable: N }), date("createdAt"), text("fileName", true), text("description", true)],
  },
  {
    key: "self_billing_authorizations", model: "selfBillingAuthorization", table: "self_billing_authorizations", title: "Self-billing authorizations", evidence: "MANDATORY",
    why: "The professional's consent under which MaestroYa issued self-billed invoices on their behalf; needed to support those invoices.",
    scope: "All rows: self-billing is used only by the legacy invoicing use cases (the lead-fee invoice flow does not reference it). IP address and user agent of acceptance are NOT archived (blocker B5).",
    currencyField: null, totalFields: [],
    fields: [pk(), ext("professionalProfileId", "professional_profiles", true), ext("companyProfileId", "company_profiles", true), en("status"), str("agreementVersion"), ext("acceptedByUserId", "users"), date("acceptedAt"), date("revokedAt", { nullable: N }), ext("revokedByUserId", "users", true), date("createdAt"), date("updatedAt")],
  },
  {
    key: "invoices", model: "invoice", table: "invoices", title: "Legacy invoices (self-billed and customer receipts)", evidence: "MANDATORY",
    why: "The tax documents. Numbers, dates, tax base, VAT, commission, IRPF withholding and totals are archived exactly; documentHash is archived verbatim as a tamper-evidence checksum.",
    scope: "Invoice of a job whose service request is LEGACY_QUOTE_PAYMENT. Party legal names and tax ids are archived only with --include-invoice-content (blocker B2).",
    currencyField: "currency", totalFields: ["taxableBase", "vatAmount", "commissionBase", "commissionAmount", "irpfWithholdingAmount", "totalAmount"],
    fields: [pk(), str("invoiceNumber", { nullable: N }), en("type"), en("status"), ref("jobId", "jobs"), ref("quoteId", "quotes"), ref("paymentId", "payments", true), ext("professionalProfileId", "professional_profiles", true), ext("companyProfileId", "company_profiles", true), ext("customerId", "customer_profiles"), ref("selfBillingAuthorizationId", "self_billing_authorizations", true), date("issueDate", { nullable: N }), date("invoiceDate"), date("acceptedAt", { nullable: N }), ext("acceptedByUserId", "users", true), str("acceptanceAgreementVersion", { nullable: N }), str("currency"), money("taxableBase"), int("vatRateBps"), money("vatAmount"), money("commissionBase"), int("commissionRateBps"), money("commissionAmount"), int("irpfWithholdingRateBps"), money("irpfWithholdingAmount"), money("totalAmount"), str("documentHash", { nullable: N }), int("version"), date("cancelledAt", { nullable: N }), ext("cancelledByUserId", "users", true), date("createdAt"), date("updatedAt"), invoiceText("issuerLegalName"), invoiceText("issuerTaxId"), invoiceText("recipientLegalName"), invoiceText("recipientTaxId", true), text("cancellationReason", true)],
  },
  {
    key: "invoice_line_items", model: "invoiceLineItem", table: "invoice_line_items", title: "Legacy invoice line items", evidence: "MANDATORY",
    why: "Line amounts of each invoice. Descriptions are archived only with --include-invoice-content (blocker B2).",
    scope: "Line of an invoice in scope. Currency is the invoice's (no currency column on the row).",
    currencyField: null, totalFields: ["amount"],
    fields: [pk(), ref("invoiceId", "invoices"), dec("quantity"), money("unitPrice"), money("amount"), int("sortOrder"), en("category"), date("createdAt"), invoiceText("description")],
  },
  {
    key: "credit_notes", model: "creditNote", table: "credit_notes", title: "Legacy credit notes", evidence: "MANDATORY",
    why: "Rectification documents that reverse part or all of an invoice; required to compute the net position of each invoice. The reason is archived only with --include-invoice-content (blocker B2).",
    scope: "Credit note of an invoice in scope.",
    currencyField: "currency", totalFields: ["reversedTaxableBase", "reversedVatAmount", "reversedCommissionAmount", "reversedIrpfWithholdingAmount", "totalAmount"],
    fields: [pk(), str("creditNoteNumber", { nullable: N }), en("status"), ref("originalInvoiceId", "invoices"), ext("professionalProfileId", "professional_profiles", true), ext("companyProfileId", "company_profiles", true), date("issueDate", { nullable: N }), str("currency"), money("reversedTaxableBase"), int("reversedVatRateBps"), money("reversedVatAmount"), money("reversedCommissionAmount"), money("reversedIrpfWithholdingAmount"), money("totalAmount"), str("documentHash", { nullable: N }), date("cancelledAt", { nullable: N }), ext("cancelledByUserId", "users", true), date("createdAt"), date("updatedAt"), invoiceText("reason")],
  },
  {
    key: "credit_note_line_items", model: "creditNoteLineItem", table: "credit_note_line_items", title: "Legacy credit note line items", evidence: "MANDATORY",
    why: "Line amounts of each credit note. Descriptions are archived only with --include-invoice-content (blocker B2).",
    scope: "Line of a credit note in scope. Currency is the credit note's (no currency column on the row).",
    currencyField: null, totalFields: ["amount"],
    fields: [pk(), ref("creditNoteId", "credit_notes"), money("amount"), date("createdAt"), invoiceText("description")],
  },
  {
    key: "invoice_number_counters", model: "invoiceNumberCounter", table: "invoice_number_counters", title: "Legacy invoice / credit-note number counters", evidence: "SUPPORTING",
    why: "Shows the last number allocated per series and year, so the numbering sequence of legacy documents can be checked for gaps.",
    scope: "Series INV and CN only. The table is shared with LEAD_V1 (series LFI, LFC), which is excluded.",
    currencyField: null, totalFields: [], idFields: ["series", "year"],
    fields: [str("series"), int("year"), int("lastValue"), date("updatedAt")],
  },
  {
    key: "reconciliation_runs", model: "reconciliationRun", table: "reconciliation_runs", title: "Legacy reconciliation runs", evidence: "MANDATORY",
    why: "Evidence of the checks performed over legacy money, including the final run required before wind-down. recordsInspected is a bounded batch, not proof of full coverage (M166).",
    scope: "All rows: reconciliation is legacy-only (the lead-fee reconciliation is a pure computation with no tables).",
    currencyField: null, totalFields: [],
    fields: [pk(), en("scope"), en("status"), date("startedAt"), date("completedAt", { nullable: N }), int("durationMs", { nullable: N }), int("recordsInspected"), int("discrepancyCount"), str("parametersHash"), ext("triggeredByUserId", "users", true), date("createdAt"), text("errorMessage", true)],
  },
  {
    key: "reconciliation_discrepancies", model: "reconciliationDiscrepancy", table: "reconciliation_discrepancies", title: "Legacy reconciliation discrepancies", evidence: "MANDATORY",
    why: "The discrepancies found and how each was resolved; needed to explain any historical amount that did not reconcile. Entity pointers are kept as ids without referential checks because a discrepancy may legitimately outlive its subject.",
    scope: "All rows (legacy-only, see reconciliation_runs).",
    currencyField: null, totalFields: [],
    fields: [pk(), ref("detectedByRunId", "reconciliation_runs"), ref("lastSeenRunId", "reconciliation_runs"), en("entityType"), f("entityId", "id", { nullable: true }), f("jobId", "id", { nullable: true }), f("paymentId", "id", { nullable: true }), f("invoiceId", "id", { nullable: true }), f("payoutId", "id", { nullable: true }), f("refundId", "id", { nullable: true }), f("creditNoteId", "id", { nullable: true }), en("category"), en("severity"), money("expectedValue", { nullable: N }), money("actualValue", { nullable: N }), money("differenceValue", { nullable: N }), str("currency", { nullable: N }), str("fingerprint"), en("resolutionStatus"), ext("resolvedByUserId", "users", true), date("resolvedAt", { nullable: N }), date("detectedAt"), date("updatedAt"), text("explanation"), text("resolutionReason", true)],
  },
  {
    key: "external_webhook_events", model: "externalWebhookEvent", table: "external_webhook_events", title: "Legacy payment webhook ledger", evidence: "SUPPORTING",
    why: "Idempotency ledger of the Stripe events that drove legacy payment state; lets a payment status be traced to the provider event.",
    scope: "provider = STRIPE_PAYMENTS only. STRIPE_LEAD_FEE_PAYMENTS (LEAD_V1) is excluded.",
    currencyField: null, totalFields: [],
    fields: [pk(), str("provider"), str("externalEventId"), str("eventType", { nullable: N }), en("status"), date("processedAt", { nullable: N }), date("createdAt"), date("updatedAt")],
  },
  {
    key: "affiliate_commissions", model: "affiliateCommission", table: "affiliate_commissions", title: "Affiliate commissions derived from legacy commissions", evidence: "MANDATORY",
    why: "Rewards computed from legacy platform commissions; part of the financial history of each legacy payment. The referral code is not archived.",
    scope: "platformCommissionRefId resolves to a legacy commission (filtered in memory after a full scan; the independent database control is therefore not available).",
    currencyField: null, totalFields: ["platformCommissionAmount", "affiliateAmount", "reversedAmount"],
    fields: [pk(), ext("partnerId", "partners"), ext("conversionEventId", "conversion_events"), ref("platformCommissionRefId", "commissions"), money("platformCommissionAmount"), money("attributableCostAmount"), money("profitBaseAmount"), int("affiliateRateBps"), money("affiliateAmount"), money("reversedAmount"), en("status"), date("approvedAt", { nullable: N }), date("cancelledAt", { nullable: N }), date("expiresAt"), date("expiredAt", { nullable: N }), date("paidAt", { nullable: N }), ext("payoutId", "partner_payouts", true), date("createdAt"), date("updatedAt"), text("cancelReason", true)],
  },
  {
    key: "affiliate_commission_reversals", model: "affiliateCommissionReversal", table: "affiliate_commission_reversals", title: "Affiliate commission reversals", evidence: "MANDATORY",
    why: "Append-only reversals of affiliate rewards after refunds, disputes and chargebacks.",
    scope: "Reversal of an affiliate commission in scope (filtered in memory).",
    currencyField: null, totalFields: ["amount"],
    fields: [pk(), ref("affiliateCommissionId", "affiliate_commissions"), money("amount"), en("type"), f("financialAdjustmentId", "id"), date("createdAt"), text("reason", true)],
  },
  {
    key: "audit_logs", model: "auditLog", table: "audit_logs", title: "Audit entries about legacy financial records", evidence: "SUPPORTING",
    why: "Who did what, and when, to payments, refunds, payouts, invoices and credit notes. Metadata, IP address and user agent are NOT archived (blocker B5).",
    scope: "entityType in the documented allow-list AND entityId equal to the id of an archived record (filtered in memory). The table is shared with every other module.",
    currencyField: null, totalFields: [],
    fields: [pk(), ext("actorUserId", "users", true), en("action"), str("entityType"), f("entityId", "id"), date("createdAt")],
  },
];

/** entityType values under which legacy financial records appear in `audit_logs` (verified against the writers at HEAD). */
export const LEGACY_AUDIT_ENTITY_TYPES: readonly string[] = [
  "PAYMENT", "COMMISSION", "TAX_BREAKDOWN", "INVOICE", "PAYOUT", "REFUND", "CREDIT_NOTE",
  "Refund", "Payout", "StripeDispute", "Dispute", "DisputeResolutionDecision", "JobCompletionConfirmation", "CreditNote", "Invoice",
  "Quote", "ServiceRequest", "SelfBillingAuthorization", "ReconciliationRun", "ReconciliationDiscrepancy",
];

/**
 * `external_webhook_events.provider` of the legacy Stripe payment webhook (LEAD_V1 uses STRIPE_LEAD_FEE_PAYMENTS, which is never
 * exported). Declared here rather than imported from the M166 module so the M166 source surface stays exactly as M166 pinned it;
 * a test asserts it equals M166's `LEGACY_PAYMENT_WEBHOOK_PROVIDER`.
 */
export const LEGACY_WEBHOOK_PROVIDER = "STRIPE_PAYMENTS";

/** Series of `invoice_number_counters` that belong to the legacy flow. LFI / LFC belong to LEAD_V1 and are never exported. */
export const LEGACY_COUNTER_SERIES: readonly string[] = ["INV", "CN"];

export interface ArchiveBlocker {
  id: string;
  kind: "LEGAL_DECISION" | "BUSINESS_DECISION" | "ENGINEERING_GAP" | "VERIFICATION_GAP";
  title: string;
  detail: string;
}

/** Unresolved decisions and gaps. They are written into every manifest so an archive can never be mistaken for an approved one. */
export const LEGACY_ARCHIVE_BLOCKERS: readonly ArchiveBlocker[] = [
  { id: "B1", kind: "LEGAL_DECISION", title: "D20 — retention periods and archive format", detail: "No retention period (minimum or maximum) is defined anywhere in the repository for financial, dispute, audit, consent or affiliate records, and none is invented here. The Spanish commercial, tax and data-protection periods, and whether the archive format is acceptable, must be confirmed by the appropriate Spanish professional adviser (gestor / abogado)." },
  { id: "B2", kind: "LEGAL_DECISION", title: "Invoice party identity and line content", detail: "Issuer / recipient legal names, tax ids, line descriptions and credit-note reasons are personal data but may be part of a legally complete invoice record. Excluded by default; included only with --include-invoice-content. The adviser must decide whether the archive must carry them or whether they stay in the database under read-only retention." },
  { id: "B3", kind: "LEGAL_DECISION", title: "Free-text explanations", detail: "Notes, reasons, descriptions and resolution notes may contain personal data and may be needed to explain a decision. Excluded by default; included only with --include-narrative. Adviser decision required." },
  { id: "B4", kind: "ENGINEERING_GAP", title: "Linked documents and assets are not archived", detail: "Dispute evidence files, request photos, message attachments and verification documents live in Cloudinary and are not copied. Invoices have no stored document (only documentHash). Preserving assets needs a copy mechanism, secure storage and a D20 decision on which assets are mandatory." },
  { id: "B5", kind: "LEGAL_DECISION", title: "Technical personal data excluded", detail: "Audit metadata, IP addresses and user agents (audit log, self-billing acceptance) are excluded. If consent evidence requires them, the adviser must say so." },
  { id: "B6", kind: "ENGINEERING_GAP", title: "No restore rehearsal", detail: "The roadmap acceptance criterion 'archive restores to a scratch database' is NOT met: this archive is a verified, self-describing evidence extract, not a database dump, and no importer exists. Database recovery remains the Module 54 backup path. A restore rehearsal needs a scratch PostgreSQL and a decision on whether history stays in-database." },
  { id: "B7", kind: "BUSINESS_DECISION", title: "Archive storage, encryption and immutability", detail: "The tool writes owner-only files (0600/0400, directory 0500) to a new directory outside any Git work tree. Encryption at rest, the storage destination, off-site copies, write-once retention and access review are not decided or implemented." },
  { id: "B8", kind: "VERIFICATION_GAP", title: "Not run against a real database", detail: "The reader is verified with a fake transaction client, static contract tests and tsc. Its queries, the READ ONLY / REPEATABLE READ transaction and its performance have not been exercised against PostgreSQL." },
  { id: "B9", kind: "VERIFICATION_GAP", title: "documentHash is not recomputed", detail: "documentHash is archived verbatim. Recomputing it requires the domain-shaped payload used at issuance (including line items and acceptance fields); the archive does not attempt it." },
  { id: "B10", kind: "BUSINESS_DECISION", title: "Approval and in-database history", detail: "The roadmap exit criterion is advisor and owner approval of the archive, and a decision on whether history stays in-database (read-only) or moves to the archive. Neither exists. M169 must not drop any table until both are recorded." },
];

/** Legacy-adjacent data that is deliberately NOT archived, with the reason. */
export const LEGACY_ARCHIVE_EXCLUSIONS: readonly { item: string; reason: string }[] = [
  { item: "Customer / professional / company profiles, users, addresses", reason: "Personal data; kept only as opaque ids so records stay traceable. Their retention follows the GDPR erasure rules, not this archive." },
  { item: "scopeAnswers (service request questionnaire JSON), request photos", reason: "Free-form customer input and personal media; not needed to explain money." },
  { item: "Quote materials, conversations, messages, message attachments, reviews, notifications", reason: "Not financial or contractual evidence; messages are private communications. Adviser may decide otherwise (B3)." },
  { item: "Dispute messages and dispute evidence file URLs", reason: "Private communications; URLs may grant access to files. See B4." },
  { item: "Idempotency keys, Stripe transfer-account data, payout accounts", reason: "Operational or credential-adjacent; not needed to interpret amounts." },
  { item: "ReconciliationScheduleCursor", reason: "Scheduler state, not evidence." },
  { item: "PartnerPayout, referral codes, referral visits, marketing attribution, conversion events", reason: "Affiliate tracking and partner payouts are kept by the roadmap (KEEP) and are not part of the legacy quote/payment history." },
  { item: "LEAD_V1 tables (leads, purchases, lead-fee ledger, invoices, credit notes, refunds, disputes) and counter series LFI / LFC", reason: "Active flow; never touched by the legacy wind-down." },
  { item: "audit_logs metadata / ipAddress / userAgent; self-billing acceptance IP and user agent", reason: "Technical personal data. See B5." },
];
