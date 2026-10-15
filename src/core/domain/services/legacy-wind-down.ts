import { DomainError } from "@/domain/errors/domain-error";
import { formatScaledDecimal, parseScaledDecimal } from "@/domain/services/fixed-point-decimal";

/**
 * Module 166 — Legacy Wind-Down & Final Settlement: pure, read-only rules (no I/O, no clock, no randomness).
 *
 * WHAT THIS IS. An inventory of every LEGACY_QUOTE_PAYMENT object that is not yet in a final state, plus a readiness view for
 * Gate C. It reads facts that are already persisted (statuses, amounts, timestamps, the state of the existing legacy
 * reconciliation) and classifies them with the status vocabulary the repository ALREADY defines. It invents no balance,
 * settlement amount, payment status, refund status or provider confirmation, and it changes nothing.
 *
 * WHAT THIS IS NOT. It is not a settlement engine: it never captures, refunds, pays out, issues, cancels or resolves anything
 * (settlement itself stays in the existing legacy use cases, e.g. the payout, refund, dispute and reconciliation use cases).
 * It is not a statement of legal, tax or accounting compliance. It never says "READY": the data can at best be
 * DATA_CLEAN_PENDING_SIGN_OFF, because retention (D20), the handling of disputed/unpaid legacy items, the notice period,
 * Gate B and the accountant sign-off cannot be known from the repository (see `LEGACY_WIND_DOWN_EXTERNAL_CONFIRMATIONS`).
 * It invents no retention period, notice period, deadline or "quiet period".
 */

export const LEGACY_WIND_DOWN_RULES_VERSION = "legacy-wind-down-rules-v1";

export const LEGACY_WIND_DOWN_NOTICE =
  "Read-only inventory of persisted legacy records. It is not a statement of legal, tax or accounting compliance, it settles nothing, and it can never declare Gate C passed.";

/** Per-item cap on the ids echoed in a report (the count is always exact). */
export const LEGACY_WIND_DOWN_MAX_IDS_PER_ITEM = 50;

export type LegacyWindDownSeverity = "INFO" | "WARNING" | "ERROR" | "CRITICAL";
/** AUTOMATIC: the persisted state alone proves the object is not final. HUMAN_REVIEW_REQUIRED: only a person can classify it. */
export type LegacyWindDownVerification = "AUTOMATIC" | "HUMAN_REVIEW_REQUIRED";
export type LegacyWindDownCategory = "OPERATIONAL" | "FINANCIAL" | "RECONCILIATION" | "DATA_INTEGRITY";

/**
 * Non-final statuses per object, taken from the repository's own state machines / enums (verified, not assumed):
 *  - ServiceRequest: only PUBLISHED (accepts quotes) and DRAFT/QUOTED (pre-acceptance) are "still entering work". ACCEPTED is a
 *    resting state: nothing in the code ever moves a request on to IN_PROGRESS/COMPLETED — the Job is the authoritative lifecycle
 *    object — so ACCEPTED requests are governed by their Job and are NOT counted here.
 *  - Quote: PENDING/SENT/VIEWED await a decision (ACCEPTED -> Job; REJECTED/EXPIRED/WITHDRAWN final).
 *  - Job: `job-state.ts` NON_TERMINAL_STATUSES.
 *  - JobCompletionConfirmation: everything but CONFIRMED, or a release still PENDING/RELEASE_HELD.
 *  - Payment: PENDING/AUTHORIZED can still be confirmed by the authoritative Stripe webhook.
 *  - Payout: PENDING/IN_TRANSIT/FAILED (retryable per `execute-professional-payout.use-case.ts`).
 *  - Refund: REQUESTED/APPROVED/FAILED. FinancialAdjustment: PENDING/FAILED.
 *  - DisputeResolutionDecision: PENDING_APPLICATION/PARTIALLY_APPLIED/FAILED.
 *  - Dispute: `dispute-state.ts` — only CLOSED is terminal (RESOLVED and REJECTED are not).
 *  - StripeDispute: NEEDS_RESPONSE/UNDER_REVIEW; a LOST dispute without a recorded adjustment needs manual reconciliation
 *    (the webhook use case closes it that way on purpose).
 *  - Invoice: `invoice-lifecycle.ts` — PROFESSIONAL_SELF_BILLED is final only at PAID/CANCELLED; CUSTOMER_RECEIPT is treated as
 *    non-final only while DRAFT (assumption, see the module document). CreditNote: DRAFT.
 *  - AffiliateCommission (derived from the legacy Commission): PENDING/APPROVED.
 *  - Commission is DELIBERATELY not an inventory object: `CommissionRepository` has no status-mutating method, so a legacy
 *    commission stays PENDING forever by construction and cannot signal "not settled".
 */
export const LEGACY_OPEN_REQUEST_STATUSES = ["DRAFT", "PUBLISHED", "QUOTED"] as const;
export const LEGACY_OPEN_QUOTE_STATUSES = ["PENDING", "SENT", "VIEWED"] as const;
export const LEGACY_OPEN_JOB_STATUSES = ["CREATED", "IN_PROGRESS"] as const;
export const LEGACY_OPEN_COMPLETION_STATUSES = ["WAITING_FOR_CUSTOMER", "DISPUTED", "TIMED_OUT_UNDER_REVIEW"] as const;
export const LEGACY_OPEN_RELEASE_STATUSES = ["PENDING", "RELEASE_HELD"] as const;
export const LEGACY_UNCONFIRMED_PAYMENT_STATUSES = ["PENDING", "AUTHORIZED"] as const;
export const LEGACY_CAPTURED_PAYMENT_STATUSES = ["CAPTURED", "PARTIALLY_REFUNDED"] as const;
export const LEGACY_OPEN_PAYOUT_STATUSES = ["PENDING", "IN_TRANSIT", "FAILED"] as const;
export const LEGACY_OPEN_REFUND_STATUSES = ["REQUESTED", "APPROVED", "FAILED"] as const;
export const LEGACY_OPEN_ADJUSTMENT_STATUSES = ["PENDING", "FAILED"] as const;
export const LEGACY_OPEN_DECISION_STATUSES = ["PENDING_APPLICATION", "PARTIALLY_APPLIED", "FAILED"] as const;
export const LEGACY_OPEN_DISPUTE_STATUSES = ["OPEN", "UNDER_REVIEW", "WAITING_FOR_CUSTOMER", "WAITING_FOR_PROFESSIONAL", "RESOLVED", "REJECTED"] as const;
export const LEGACY_OPEN_STRIPE_DISPUTE_STATUSES = ["NEEDS_RESPONSE", "UNDER_REVIEW"] as const;
export const LEGACY_OPEN_SELF_BILLED_INVOICE_STATUSES = ["DRAFT", "PENDING_ACCEPTANCE", "ACCEPTED", "ISSUED"] as const;
export const LEGACY_OPEN_RECEIPT_INVOICE_STATUSES = ["DRAFT"] as const;
export const LEGACY_OPEN_CREDIT_NOTE_STATUSES = ["DRAFT"] as const;
export const LEGACY_OPEN_AFFILIATE_COMMISSION_STATUSES = ["PENDING", "APPROVED"] as const;
export const LEGACY_UNSETTLED_WEBHOOK_STATUSES = ["PROCESSING", "FAILED"] as const;
/** Idempotency-ledger provider key of the legacy customer-payment webhook stream (distinct from the lead-fee stream). */
export const LEGACY_PAYMENT_WEBHOOK_PROVIDER = "STRIPE_PAYMENTS";

export interface ObservedLegacyServiceRequest { id: string; status: string; createdAt: Date }
export interface ObservedLegacyQuote { id: string; status: string; validUntil: Date | null }
export interface ObservedLegacyJob { id: string; status: string }
export interface ObservedLegacyCompletionConfirmation { id: string; jobId: string; status: string; releaseStatus: string }
export interface ObservedLegacyPayment { id: string; status: string; amount: string; currency: string }
export interface ObservedLegacyCapturedPayment extends ObservedLegacyPayment {
  /** Status of the Job reached through the payment's quote; null when there is none. */
  jobStatus: string | null;
  /** Release status of that Job's completion confirmation; null when there is none. */
  releaseStatus: string | null;
  /** Statuses of every payout linked to this payment (by payment id or by its job). */
  payoutStatuses: readonly string[];
}
export interface ObservedLegacyPayout { id: string; status: string; amount: string; currency: string; jobId: string | null; reversalIncomplete: boolean }
/** `currency` is the currency of the refunded payment (the refund row itself has none). */
export interface ObservedLegacyRefund { id: string; status: string; amount: string; currency: string; paymentId: string }
export interface ObservedLegacyFinancialAdjustment { id: string; status: string; amount: string; currency: string; jobId: string }
export interface ObservedLegacyDisputeResolutionDecision { id: string; status: string; disputeId: string }
export interface ObservedLegacyDispute { id: string; status: string }
export interface ObservedLegacyStripeDispute {
  id: string;
  status: string;
  amount: string;
  currency: string;
  financialAdjustmentId: string | null;
}
export interface ObservedLegacyInvoice { id: string; type: string; status: string; totalAmount: string; currency: string }
export interface ObservedLegacyCreditNote { id: string; status: string; totalAmount: string; currency: string }
export interface ObservedLegacyAffiliateCommission { id: string; status: string; affiliateAmount: string }
export interface ObservedLegacyWebhookEvent { id: string; status: string }

export interface ObservedLegacyReconciliationState {
  /** OPEN discrepancies of the existing legacy reconciliation, by severity. */
  openDiscrepancies: Record<LegacyWindDownSeverity, number>;
  /** Most recent COMPLETED run with scope FULL; null when none exists. */
  latestCompletedFullRun: { id: string; startedAt: Date; completedAt: Date | null; discrepancyCount: number; recordsInspected: number } | null;
  /** Runs currently in RUNNING state (any scope). */
  runningRunCount: number;
}

export interface LegacyWindDownSnapshot {
  serviceRequests: readonly ObservedLegacyServiceRequest[];
  quotes: readonly ObservedLegacyQuote[];
  jobs: readonly ObservedLegacyJob[];
  completionConfirmations: readonly ObservedLegacyCompletionConfirmation[];
  unconfirmedPayments: readonly ObservedLegacyPayment[];
  capturedPayments: readonly ObservedLegacyCapturedPayment[];
  payouts: readonly ObservedLegacyPayout[];
  refunds: readonly ObservedLegacyRefund[];
  financialAdjustments: readonly ObservedLegacyFinancialAdjustment[];
  disputeResolutionDecisions: readonly ObservedLegacyDisputeResolutionDecision[];
  disputes: readonly ObservedLegacyDispute[];
  stripeDisputes: readonly ObservedLegacyStripeDispute[];
  invoices: readonly ObservedLegacyInvoice[];
  creditNotes: readonly ObservedLegacyCreditNote[];
  affiliateCommissions: readonly ObservedLegacyAffiliateCommission[];
  webhookEvents: readonly ObservedLegacyWebhookEvent[];
  reconciliation: ObservedLegacyReconciliationState;
  /** Latest `updatedAt` over the legacy financial tables; null when there are none. */
  latestLegacyFinancialChangeAt: Date | null;
  /** Context only: how many legacy requests exist and when the newest was created (no period is judged here). */
  legacyRequestTotal: number;
  newestLegacyRequestCreatedAt: Date | null;
}

export type LegacyWindDownFindingCode =
  | "LEGACY_REQUEST_OPEN"
  | "LEGACY_QUOTE_OPEN"
  | "LEGACY_JOB_NON_TERMINAL"
  | "LEGACY_COMPLETION_CONFIRMATION_OPEN"
  | "LEGACY_PAYMENT_UNCONFIRMED"
  | "LEGACY_CAPTURED_PAYMENT_WITHOUT_FINAL_DISPOSITION"
  | "LEGACY_PAYOUT_NOT_FINAL"
  | "LEGACY_PAYOUT_REVERSAL_INCOMPLETE"
  | "LEGACY_REFUND_NOT_FINAL"
  | "LEGACY_FINANCIAL_ADJUSTMENT_NOT_FINAL"
  | "LEGACY_DISPUTE_DECISION_NOT_APPLIED"
  | "LEGACY_DISPUTE_NOT_CLOSED"
  | "LEGACY_STRIPE_DISPUTE_OPEN"
  | "LEGACY_STRIPE_DISPUTE_LOST_WITHOUT_ADJUSTMENT"
  | "LEGACY_INVOICE_NOT_FINAL"
  | "LEGACY_CREDIT_NOTE_NOT_FINAL"
  | "LEGACY_AFFILIATE_COMMISSION_OPEN"
  | "LEGACY_WEBHOOK_EVENT_UNSETTLED"
  | "LEGACY_FINAL_RECONCILIATION_MISSING"
  | "LEGACY_FINAL_RECONCILIATION_STALE"
  | "LEGACY_RECONCILIATION_RUN_IN_PROGRESS"
  | "LEGACY_RECONCILIATION_DISCREPANCIES_OPEN"
  | "LEGACY_AMOUNT_UNPARSEABLE";

interface CatalogEntry {
  category: LegacyWindDownCategory;
  severity: LegacyWindDownSeverity;
  verification: LegacyWindDownVerification;
  /** Every finding blocks the data side of Gate C; the flag exists so a future INFO-only code can be added without changing semantics. */
  blocksGateC: boolean;
  /** Existing path a human/operator can use. Never executed by this module. */
  nextAction: string;
}

/**
 * Severity and verification are a pure function of the code (never chosen per call site). `nextAction` only names paths that
 * already exist; where no existing path resolves the item, it says so and points at the decision that is missing.
 */
export const LEGACY_WIND_DOWN_CATALOG: Readonly<Record<LegacyWindDownFindingCode, CatalogEntry>> = {
  LEGACY_REQUEST_OPEN: { category: "OPERATIONAL", severity: "WARNING", verification: "AUTOMATIC", blocksGateC: true, nextAction: "Customer cancel (existing) or expiry by expiresAt (daily expire-workflows cron). A deadline for open legacy requests is a D20 / notice-period decision and is NOT set by M166." },
  LEGACY_QUOTE_OPEN: { category: "OPERATIONAL", severity: "WARNING", verification: "AUTOMATIC", blocksGateC: true, nextAction: "Accept, reject, withdraw (existing) or expiry by validUntil (daily expire-workflows cron)." },
  LEGACY_JOB_NON_TERMINAL: { category: "OPERATIONAL", severity: "ERROR", verification: "AUTOMATIC", blocksGateC: true, nextAction: "Complete or cancel through the existing job use cases. No job deadline exists in the repository; setting one is a D20 / business decision." },
  LEGACY_COMPLETION_CONFIRMATION_OPEN: { category: "FINANCIAL", severity: "ERROR", verification: "AUTOMATIC", blocksGateC: true, nextAction: "Customer confirmation, the existing timeout (-> TIMED_OUT_UNDER_REVIEW) or the existing admin payment-release resolution. Held releases need a human decision." },
  LEGACY_PAYMENT_UNCONFIRMED: { category: "FINANCIAL", severity: "ERROR", verification: "AUTOMATIC", blocksGateC: true, nextAction: "Wait for the authoritative Stripe webhook (never a browser redirect). Do not mark paid or failed by hand; keep the stripe-payments webhook route live." },
  LEGACY_CAPTURED_PAYMENT_WITHOUT_FINAL_DISPOSITION: { category: "FINANCIAL", severity: "CRITICAL", verification: "HUMAN_REVIEW_REQUIRED", blocksGateC: true, nextAction: "Captured funds with no PAID payout, no in-flight job/release/payout and no full refund. Review the payment: payout via the existing admin payout retry, or refund via the existing refund use case. Handling of such cases is a D20 / legal-business decision." },
  LEGACY_PAYOUT_NOT_FINAL: { category: "FINANCIAL", severity: "ERROR", verification: "AUTOMATIC", blocksGateC: true, nextAction: "Existing payout retry/reconciliation (execute-professional-payout is idempotent per job). FAILED payouts need an operator." },
  LEGACY_PAYOUT_REVERSAL_INCOMPLETE: { category: "FINANCIAL", severity: "CRITICAL", verification: "AUTOMATIC", blocksGateC: true, nextAction: "A payout reversal failed and the payout is still not REVERSED. Retry through the existing reverse-professional-payout use case (idempotent)." },
  LEGACY_REFUND_NOT_FINAL: { category: "FINANCIAL", severity: "ERROR", verification: "AUTOMATIC", blocksGateC: true, nextAction: "Execute/retry through the existing refund use case (idempotency key on the refund). Do not introduce a Stripe-fee deduction." },
  LEGACY_FINANCIAL_ADJUSTMENT_NOT_FINAL: { category: "FINANCIAL", severity: "ERROR", verification: "AUTOMATIC", blocksGateC: true, nextAction: "Apply or reject through the existing financial-adjustment path (idempotency key on the adjustment)." },
  LEGACY_DISPUTE_DECISION_NOT_APPLIED: { category: "FINANCIAL", severity: "ERROR", verification: "AUTOMATIC", blocksGateC: true, nextAction: "Re-apply through the existing dispute-resolution application path (idempotent per decision)." },
  LEGACY_DISPUTE_NOT_CLOSED: { category: "OPERATIONAL", severity: "WARNING", verification: "AUTOMATIC", blocksGateC: true, nextAction: "Resolve/reject and close through the existing admin dispute flow. Handling of disputed legacy items is a LEGAL/BUSINESS decision." },
  LEGACY_STRIPE_DISPUTE_OPEN: { category: "FINANCIAL", severity: "CRITICAL", verification: "AUTOMATIC", blocksGateC: true, nextAction: "Provider-side chargeback still open. Respond with evidence before evidenceDueBy; the outcome arrives by webhook. Keep the stripe-payments webhook route live." },
  LEGACY_STRIPE_DISPUTE_LOST_WITHOUT_ADJUSTMENT: { category: "FINANCIAL", severity: "CRITICAL", verification: "HUMAN_REVIEW_REQUIRED", blocksGateC: true, nextAction: "A lost chargeback was closed WITHOUT a recorded financial adjustment (the webhook flags this for manual reconciliation). A person must reconcile it; nothing is inferred here." },
  LEGACY_INVOICE_NOT_FINAL: { category: "FINANCIAL", severity: "ERROR", verification: "AUTOMATIC", blocksGateC: true, nextAction: "Existing invoice lifecycle: DRAFT -> PENDING_ACCEPTANCE -> ACCEPTED -> ISSUED -> PAID (on payout). An ISSUED invoice that will never be paid out cannot be cancelled (immutable); that is an accounting decision (credit note) and not decided here." },
  LEGACY_CREDIT_NOTE_NOT_FINAL: { category: "FINANCIAL", severity: "WARNING", verification: "AUTOMATIC", blocksGateC: true, nextAction: "Issue or cancel through the existing credit-note use cases." },
  LEGACY_AFFILIATE_COMMISSION_OPEN: { category: "FINANCIAL", severity: "ERROR", verification: "AUTOMATIC", blocksGateC: true, nextAction: "Existing affiliate approve / expire / payout / reversal paths. The M162 lead-fee reward model is separate and not evaluated here." },
  LEGACY_WEBHOOK_EVENT_UNSETTLED: { category: "DATA_INTEGRITY", severity: "ERROR", verification: "AUTOMATIC", blocksGateC: true, nextAction: "A legacy payment webhook event is PROCESSING or FAILED in the idempotency ledger. FAILED events are redelivered by Stripe; investigate before closing." },
  LEGACY_FINAL_RECONCILIATION_MISSING: { category: "RECONCILIATION", severity: "ERROR", verification: "AUTOMATIC", blocksGateC: true, nextAction: "No COMPLETED reconciliation run with scope FULL exists. Start one through the existing admin reconciliation run (a scheduled run with a narrower scope does not count)." },
  LEGACY_FINAL_RECONCILIATION_STALE: { category: "RECONCILIATION", severity: "ERROR", verification: "AUTOMATIC", blocksGateC: true, nextAction: "Legacy financial records changed after the latest COMPLETED FULL reconciliation run started. Run it again." },
  LEGACY_RECONCILIATION_RUN_IN_PROGRESS: { category: "RECONCILIATION", severity: "WARNING", verification: "AUTOMATIC", blocksGateC: true, nextAction: "A reconciliation run is RUNNING. Wait for it, or investigate a stuck run, before treating any run as final." },
  LEGACY_RECONCILIATION_DISCREPANCIES_OPEN: { category: "RECONCILIATION", severity: "ERROR", verification: "AUTOMATIC", blocksGateC: true, nextAction: "Resolve each OPEN discrepancy through the existing resolve-discrepancy use case (with a reason). Never delete records to make a run look clean." },
  LEGACY_AMOUNT_UNPARSEABLE: { category: "DATA_INTEGRITY", severity: "ERROR", verification: "AUTOMATIC", blocksGateC: true, nextAction: "An amount could not be read as an exact decimal; it was excluded from totals and the item stays blocking. Inspect the row." },
};

export interface LegacyWindDownItem {
  code: LegacyWindDownFindingCode;
  category: LegacyWindDownCategory;
  severity: LegacyWindDownSeverity;
  verification: LegacyWindDownVerification;
  blocksGateC: boolean;
  /** Exact number of objects. */
  count: number;
  byStatus: Record<string, number>;
  /** Exact 2-decimal totals per currency over the parseable amounts (never netted across items). Absent for non-monetary items. */
  amountByCurrency?: Record<string, string>;
  /** Sorted ascending, capped at LEGACY_WIND_DOWN_MAX_IDS_PER_ITEM. */
  ids: string[];
  idsTruncated: boolean;
  nextAction: string;
}

/** Facts that no repository state can prove. They are listed in every report and are NEVER reported as confirmed. */
export const LEGACY_WIND_DOWN_EXTERNAL_CONFIRMATIONS = [
  { id: "D20_RETENTION_AND_WIND_DOWN_HANDLING", description: "D20: retention periods and what happens to open legacy requests/jobs (legal/business decision)." },
  { id: "DISPUTED_OR_UNPAID_LEGACY_ITEMS_HANDLING", description: "Handling of disputed or unpaid legacy items (legal/business decision required by the roadmap)." },
  { id: "CUSTOMER_PROFESSIONAL_NOTICE_PERIOD", description: "Customer/professional notice period before legacy is closed (legal/business decision)." },
  { id: "GATE_B_PASSED", description: "Gate B approved by its own checklist (M159 §10); M165 and M166 do not pass it." },
  { id: "ZERO_NEW_LEGACY_REQUESTS_PERIOD", description: "The 'defined period' of zero new legacy requests (M165 exit criterion) has no defined length in the repository; compare newestLegacyRequestCreatedAt only after it is defined." },
  { id: "LATE_DISPUTE_GRACE_WINDOW", description: "How long the legacy payment webhook handlers must stay live for late disputes/refunds (the roadmap defers this to the M168 grace period; no length is defined)." },
  {
    id: "RECONCILIATION_COVERAGE_COMPLETE",
    description:
      "A reconciliation run inspects a bounded batch of jobs (scheduled: RECONCILIATION_SCHEDULE_LIMIT per invocation with an advancing cursor; manual: a limit with a ceiling), so 'FULL' is a check scope, not a coverage guarantee. Nothing persisted proves that every legacy job was inspected after the last change; an operator must confirm a complete sweep cycle (or manual runs covering every legacy job).",
  },
  { id: "ACCOUNTANT_SIGN_OFF", description: "Accountant sign-off of the final legacy reconciliation (acceptance criterion). No sign-off record exists in the repository." },
] as const;
export type LegacyWindDownExternalConfirmationId = (typeof LEGACY_WIND_DOWN_EXTERNAL_CONFIRMATIONS)[number]["id"];

/**
 * NOT_READY: the persisted data still contains non-final legacy objects or an unsettled reconciliation.
 * DATA_CLEAN_PENDING_SIGN_OFF: no blocking finding in the data — and STILL not "ready": every external confirmation remains open.
 * There is deliberately no READY value.
 */
export type LegacyWindDownDecision = "NOT_READY" | "DATA_CLEAN_PENDING_SIGN_OFF";

export interface LegacyWindDownReadiness {
  decision: LegacyWindDownDecision;
  dataClean: boolean;
  blockingCodes: LegacyWindDownFindingCode[];
  externalConfirmations: ReadonlyArray<{ id: LegacyWindDownExternalConfirmationId; description: string; status: "NOT_VERIFIABLE_FROM_REPOSITORY" }>;
}

export interface LegacyWindDownEvaluation {
  items: LegacyWindDownItem[];
  readiness: LegacyWindDownReadiness;
  context: {
    legacyRequestTotal: number;
    newestLegacyRequestCreatedAt: Date | null;
    latestLegacyFinancialChangeAt: Date | null;
    /** The run the staleness rule used, as persisted (recordsInspected is a raw figure: it does not prove coverage). */
    latestCompletedFullRun: ObservedLegacyReconciliationState["latestCompletedFullRun"];
  };
}

const SCALE = 2;
export const NO_CURRENCY_ON_RECORD = "NO_CURRENCY_ON_RECORD";
const SEVERITY_RANK: Record<LegacyWindDownSeverity, number> = { CRITICAL: 0, ERROR: 1, WARNING: 2, INFO: 3 };

interface Row { id: string; status: string }

function build(
  code: LegacyWindDownFindingCode,
  rows: ReadonlyArray<{ id: string; status?: string; amount?: string; currency?: string }>,
  options: { monetary?: boolean } = {},
): LegacyWindDownItem | null {
  if (rows.length === 0) return null;
  const entry = LEGACY_WIND_DOWN_CATALOG[code];
  const byStatus: Record<string, number> = {};
  const totals = new Map<string, bigint>();
  for (const r of rows) {
    const key = r.status ?? "UNSPECIFIED";
    byStatus[key] = (byStatus[key] ?? 0) + 1;
    if (options.monetary) {
      const cents = parseScaledDecimal(r.amount, SCALE);
      if (cents !== null && typeof r.currency === "string" && r.currency.length > 0) {
        totals.set(r.currency, (totals.get(r.currency) ?? 0n) + cents);
      }
    }
  }
  const ids = rows.map((r) => r.id).sort();
  const item: LegacyWindDownItem = {
    code,
    category: entry.category,
    severity: entry.severity,
    verification: entry.verification,
    blocksGateC: entry.blocksGateC,
    count: rows.length,
    byStatus: Object.fromEntries(Object.entries(byStatus).sort(([a], [b]) => a.localeCompare(b))),
    ids: ids.slice(0, LEGACY_WIND_DOWN_MAX_IDS_PER_ITEM),
    idsTruncated: ids.length > LEGACY_WIND_DOWN_MAX_IDS_PER_ITEM,
    nextAction: entry.nextAction,
  };
  if (options.monetary) {
    item.amountByCurrency = Object.fromEntries(
      [...totals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([cur, cents]) => [cur, formatScaledDecimal(cents, SCALE, 2)]),
    );
  }
  return item;
}

/** An item that has an exact count but no per-object ids (reconciliation state). */
function countItem(code: LegacyWindDownFindingCode, count: number, byStatus: Record<string, number>): LegacyWindDownItem {
  const entry = LEGACY_WIND_DOWN_CATALOG[code];
  return {
    code,
    category: entry.category,
    severity: entry.severity,
    verification: entry.verification,
    blocksGateC: entry.blocksGateC,
    count,
    byStatus,
    ids: [],
    idsTruncated: false,
    nextAction: entry.nextAction,
  };
}

const isIn = <T extends string>(set: readonly T[], value: string): boolean => (set as readonly string[]).includes(value);

/**
 * A captured payment is in a final disposition only when a payout for it is PAID. It is in flight (and covered by another
 * finding) while its job is non-terminal, its release is PENDING/RELEASE_HELD, or any linked payout is not final. Anything
 * else — captured funds with no PAID payout, no job, a denied release or an approved release without any payout — has no
 * final disposition in the data and needs a person. This is a classification of persisted facts; no amount is derived.
 */
export function hasFinalDisposition(payment: ObservedLegacyCapturedPayment): boolean {
  return payment.payoutStatuses.includes("PAID");
}

export function isCapturedPaymentInFlight(payment: ObservedLegacyCapturedPayment): boolean {
  if (payment.jobStatus !== null && isIn(LEGACY_OPEN_JOB_STATUSES, payment.jobStatus)) return true;
  if (payment.releaseStatus !== null && isIn(LEGACY_OPEN_RELEASE_STATUSES, payment.releaseStatus)) return true;
  return payment.payoutStatuses.some((s) => isIn(LEGACY_OPEN_PAYOUT_STATUSES, s));
}

export function evaluateLegacyWindDown(snapshot: LegacyWindDownSnapshot): LegacyWindDownEvaluation {
  const items: LegacyWindDownItem[] = [];
  const push = (item: LegacyWindDownItem | null) => {
    if (item) items.push(item);
  };

  // Defence in depth: the reader already filters by these sets; a row that does not match is NOT counted as open.
  const open = <R extends Row>(rows: readonly R[], set: readonly string[]) => rows.filter((r) => set.includes(r.status));

  push(build("LEGACY_REQUEST_OPEN", open(snapshot.serviceRequests, LEGACY_OPEN_REQUEST_STATUSES)));
  push(build("LEGACY_QUOTE_OPEN", open(snapshot.quotes, LEGACY_OPEN_QUOTE_STATUSES)));
  push(build("LEGACY_JOB_NON_TERMINAL", open(snapshot.jobs, LEGACY_OPEN_JOB_STATUSES)));
  push(
    build(
      "LEGACY_COMPLETION_CONFIRMATION_OPEN",
      snapshot.completionConfirmations.filter((c) => isIn(LEGACY_OPEN_COMPLETION_STATUSES, c.status) || isIn(LEGACY_OPEN_RELEASE_STATUSES, c.releaseStatus)),
    ),
  );
  push(build("LEGACY_PAYMENT_UNCONFIRMED", open(snapshot.unconfirmedPayments, LEGACY_UNCONFIRMED_PAYMENT_STATUSES), { monetary: true }));
  push(
    build(
      "LEGACY_CAPTURED_PAYMENT_WITHOUT_FINAL_DISPOSITION",
      snapshot.capturedPayments.filter(
        (p) => isIn(LEGACY_CAPTURED_PAYMENT_STATUSES, p.status) && !hasFinalDisposition(p) && !isCapturedPaymentInFlight(p),
      ),
      { monetary: true },
    ),
  );
  push(build("LEGACY_PAYOUT_NOT_FINAL", open(snapshot.payouts, LEGACY_OPEN_PAYOUT_STATUSES), { monetary: true }));
  push(build("LEGACY_PAYOUT_REVERSAL_INCOMPLETE", snapshot.payouts.filter((p) => p.reversalIncomplete && p.status !== "REVERSED"), { monetary: true }));
  push(build("LEGACY_REFUND_NOT_FINAL", open(snapshot.refunds, LEGACY_OPEN_REFUND_STATUSES), { monetary: true }));
  push(build("LEGACY_FINANCIAL_ADJUSTMENT_NOT_FINAL", open(snapshot.financialAdjustments, LEGACY_OPEN_ADJUSTMENT_STATUSES), { monetary: true }));
  push(build("LEGACY_DISPUTE_DECISION_NOT_APPLIED", open(snapshot.disputeResolutionDecisions, LEGACY_OPEN_DECISION_STATUSES)));
  push(build("LEGACY_DISPUTE_NOT_CLOSED", open(snapshot.disputes, LEGACY_OPEN_DISPUTE_STATUSES)));
  push(build("LEGACY_STRIPE_DISPUTE_OPEN", open(snapshot.stripeDisputes, LEGACY_OPEN_STRIPE_DISPUTE_STATUSES), { monetary: true }));
  push(
    build(
      "LEGACY_STRIPE_DISPUTE_LOST_WITHOUT_ADJUSTMENT",
      snapshot.stripeDisputes.filter((d) => d.status === "LOST" && d.financialAdjustmentId === null),
      { monetary: true },
    ),
  );
  push(
    build(
      "LEGACY_INVOICE_NOT_FINAL",
      snapshot.invoices
        .filter((i) =>
          i.type === "PROFESSIONAL_SELF_BILLED"
            ? isIn(LEGACY_OPEN_SELF_BILLED_INVOICE_STATUSES, i.status)
            : i.type === "CUSTOMER_RECEIPT"
              ? isIn(LEGACY_OPEN_RECEIPT_INVOICE_STATUSES, i.status)
              : false,
        )
        .map((i) => ({ id: i.id, status: `${i.type}:${i.status}`, amount: i.totalAmount, currency: i.currency })),
      { monetary: true },
    ),
  );
  push(build("LEGACY_CREDIT_NOTE_NOT_FINAL", open(snapshot.creditNotes, LEGACY_OPEN_CREDIT_NOTE_STATUSES).map((c) => ({ id: c.id, status: c.status, amount: c.totalAmount, currency: c.currency })), { monetary: true }));
  push(
    build(
      "LEGACY_AFFILIATE_COMMISSION_OPEN",
      // The affiliate commission row has no currency column; its total is reported under an explicit marker, never assumed EUR.
      open(snapshot.affiliateCommissions, LEGACY_OPEN_AFFILIATE_COMMISSION_STATUSES).map((c) => ({ id: c.id, status: c.status, amount: c.affiliateAmount, currency: NO_CURRENCY_ON_RECORD })),
      { monetary: true },
    ),
  );
  push(build("LEGACY_WEBHOOK_EVENT_UNSETTLED", open(snapshot.webhookEvents, LEGACY_UNSETTLED_WEBHOOK_STATUSES)));

  // Reconciliation state (the existing legacy reconciliation framework is the system of record; this only reads it).
  const rec = snapshot.reconciliation;
  const run = rec.latestCompletedFullRun;
  if (run === null) {
    items.push(countItem("LEGACY_FINAL_RECONCILIATION_MISSING", 1, { NO_COMPLETED_FULL_RUN: 1 }));
  } else if (snapshot.latestLegacyFinancialChangeAt !== null && snapshot.latestLegacyFinancialChangeAt.getTime() > run.startedAt.getTime()) {
    const stale = countItem("LEGACY_FINAL_RECONCILIATION_STALE", 1, { FULL_RUN_OLDER_THAN_LATEST_CHANGE: 1 });
    stale.ids = [run.id];
    items.push(stale);
  }
  if (rec.runningRunCount > 0) {
    items.push(countItem("LEGACY_RECONCILIATION_RUN_IN_PROGRESS", rec.runningRunCount, { RUNNING: rec.runningRunCount }));
  }
  // The discrepancy rows live in the reconciliation tables; only exact counts by severity are reported here.
  const severities = Object.keys(SEVERITY_RANK) as LegacyWindDownSeverity[];
  const openDiscrepancies = severities.reduce((n, s) => n + (rec.openDiscrepancies[s] ?? 0), 0);
  if (openDiscrepancies > 0) {
    items.push(
      countItem(
        "LEGACY_RECONCILIATION_DISCREPANCIES_OPEN",
        openDiscrepancies,
        Object.fromEntries(severities.filter((s) => (rec.openDiscrepancies[s] ?? 0) > 0).map((s) => [s, rec.openDiscrepancies[s]])),
      ),
    );
  }

  // Unparseable monetary values never disappear silently: they are excluded from totals and reported.
  const unparseable = collectUnparseableAmounts(snapshot);
  push(build("LEGACY_AMOUNT_UNPARSEABLE", unparseable));

  items.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.code.localeCompare(b.code));

  const blockingCodes = items.filter((i) => i.blocksGateC).map((i) => i.code);
  const dataClean = blockingCodes.length === 0;
  return {
    items,
    readiness: {
      decision: dataClean ? "DATA_CLEAN_PENDING_SIGN_OFF" : "NOT_READY",
      dataClean,
      blockingCodes,
      externalConfirmations: LEGACY_WIND_DOWN_EXTERNAL_CONFIRMATIONS.map((c) => ({ ...c, status: "NOT_VERIFIABLE_FROM_REPOSITORY" as const })),
    },
    context: {
      legacyRequestTotal: snapshot.legacyRequestTotal,
      newestLegacyRequestCreatedAt: snapshot.newestLegacyRequestCreatedAt,
      latestLegacyFinancialChangeAt: snapshot.latestLegacyFinancialChangeAt,
      latestCompletedFullRun: snapshot.reconciliation.latestCompletedFullRun,
    },
  };
}

function collectUnparseableAmounts(s: LegacyWindDownSnapshot): Row[] {
  const bad: Row[] = [];
  const check = (id: string, kind: string, amount: string) => {
    if (parseScaledDecimal(amount, SCALE) === null) bad.push({ id, status: kind });
  };
  for (const r of s.unconfirmedPayments) check(r.id, "PAYMENT", r.amount);
  for (const r of s.capturedPayments) check(r.id, "PAYMENT", r.amount);
  for (const r of s.payouts) check(r.id, "PAYOUT", r.amount);
  for (const r of s.refunds) check(r.id, "REFUND", r.amount);
  for (const r of s.financialAdjustments) check(r.id, "FINANCIAL_ADJUSTMENT", r.amount);
  for (const r of s.stripeDisputes) check(r.id, "STRIPE_DISPUTE", r.amount);
  for (const r of s.invoices) check(r.id, "INVOICE", r.totalAmount);
  for (const r of s.creditNotes) check(r.id, "CREDIT_NOTE", r.totalAmount);
  for (const r of s.affiliateCommissions) check(r.id, "AFFILIATE_COMMISSION", r.affiliateAmount);
  return bad;
}

/** A table above the per-kind ceiling makes the run fail; a subset is never reported as the whole. */
export class LegacyWindDownScopeTooLargeError extends DomainError {
  readonly code = "LEGACY_WIND_DOWN_SCOPE_TOO_LARGE";
  constructor(readonly table: string, readonly limit: number) {
    super(`The legacy wind-down inventory exceeds ${limit} rows for "${table}"; refusing to report a partial inventory.`);
  }
}
