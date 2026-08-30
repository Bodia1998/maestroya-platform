/**
 * Module 79 — Invoicing & Credit Notes: repository interface for the
 * `Invoice` aggregate — the professional's self-billed invoice to
 * MaestroYa for a completed, paid Job (see the module brief's "INVOICE
 * LIFECYCLE"/"INVOICE DATA" sections).
 *
 * ## Why an immutable financial snapshot, not a live join
 * Every financial figure on `InvoiceRecord` (line items, taxable base,
 * IVA rate/amount, commission, totals) is captured at DRAFT-creation time
 * from Module 78's `CalculateJobTaxBreakdownUseCase` and the Quote's own
 * line items, then never recomputed from live Quote/Commission-rate data
 * again — see the module brief's "DOCUMENT IMMUTABILITY" section. A rate
 * change, a Quote edit (impossible after acceptance, but defensively
 * assumed anyway), or a later commission-policy change must never alter
 * an already-created invoice's numbers.
 *
 * ## Lifecycle
 * DRAFT -> PENDING_ACCEPTANCE -> ACCEPTED -> ISSUED -> PAID, with CANCELLED
 * reachable from DRAFT/PENDING_ACCEPTANCE only — see
 * `domain/services/invoice-lifecycle.ts` for the authoritative transition
 * table. This repository never enforces the state machine itself; every
 * mutating method takes an explicit `fromStatuses` compare-and-swap guard
 * (same convention as `JobRepository.startWork`/`PayoutRepository.markPaid`)
 * so a lost race or a stale caller can never silently apply an invalid
 * transition, and the use case layer is the only place that consults
 * `canTransitionInvoiceStatus` before calling.
 */

export type InvoiceStatusValue =
  | "DRAFT"
  | "PENDING_ACCEPTANCE"
  | "ACCEPTED"
  | "ISSUED"
  | "PAID"
  | "CANCELLED";

/**
 * `PROFESSIONAL_SELF_BILLED` — the professional/company -> MaestroYa
 * self-billing invoice the module brief's "PROFESSIONAL -> MAESTROYA"
 * example describes; goes through the full DRAFT -> PENDING_ACCEPTANCE ->
 * ACCEPTED -> ISSUED electronic-acceptance lifecycle (see
 * `domain/services/invoice-lifecycle.ts`).
 *
 * `CUSTOMER_RECEIPT` (Module 85 — Invoicing & Credit Note Activation) —
 * the genuinely different economic relationship the original Module 79
 * doc comment reserved this field for: MaestroYa (the issuer of record —
 * see `domain/services/invoicing-issuer.ts`) billing the actual paying
 * customer for the job. A `CUSTOMER_RECEIPT` is never self-billing (there
 * is no `SelfBillingAuthorizationRecord` — `selfBillingAuthorizationId`
 * is `null` — and no electronic-acceptance step: the customer never
 * "accepts" a receipt for something they already paid for). It is issued
 * directly from DRAFT — see `domain/services/invoice-lifecycle.ts`'s own
 * `issuableFromStatus`. It shares the same table/repository/numbering/
 * hashing machinery as `PROFESSIONAL_SELF_BILLED` deliberately — Module 85
 * explicitly reuses the existing Invoice engine rather than building a
 * second one.
 */
export type InvoiceTypeValue = "PROFESSIONAL_SELF_BILLED" | "CUSTOMER_RECEIPT";

export interface InvoiceLineItemRecord {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  sortOrder: number;
  /** Mirrors `QuoteItemCategoryValue` — preserved on the snapshot so a
   *  reader can tell labour from professional-supplied materials without
   *  re-deriving it from the (by then possibly-stale) Quote. Never
   *  includes a CUSTOMER_PURCHASED materials line — see this file's own
   *  doc comment and `CreateProfessionalInvoiceDraftUseCase`'s doc
   *  comment on why that would be a defect, not a feature. */
  category: "LABOR" | "MATERIALS";
}

export interface InvoiceLineItemInput {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  category: "LABOR" | "MATERIALS";
}

export interface InvoiceRecord {
  id: string;
  /** Human-readable, sequential, allocated exactly once — only at ISSUE
   *  time (see `IssueInvoiceUseCase`) — never at DRAFT-creation time, so
   *  an invoice abandoned in DRAFT never burns a number. `null` for every
   *  non-ISSUED/PAID status. See `domain/services/invoice-numbering.ts`. */
  invoiceNumber: string | null;
  type: InvoiceTypeValue;
  status: InvoiceStatusValue;

  // --- Source references (Module 79 integration contract) ---
  jobId: string;
  quoteId: string;
  paymentId: string | null;

  // --- Parties ---
  /** Exactly one of professionalProfileId/companyProfileId is set — same
   *  duality as Job/Quote/Payout. */
  professionalProfileId: string | null;
  companyProfileId: string | null;
  customerId: string;

  // --- Issuer/recipient legal-identity snapshot ---
  /** MaestroYa is always the issuer of record under self-billing — this
   *  is a fixed, configuration-level identifier (never a per-invoice
   *  input), kept as a field (rather than hardcoded in a template) so a
   *  future legal-entity change never requires a schema change. */
  issuerLegalName: string;
  issuerTaxId: string;
  /** The professional/company being invoiced (the "recipient" of a
   *  self-billed invoice is the party who would otherwise have issued
   *  it themselves) — captured at DRAFT time from
   *  `ProfessionalRecord`/`CompanyRecord`, never re-read live once
   *  ISSUED. */
  recipientLegalName: string;
  recipientTaxId: string | null;

  // --- Self-billing (only meaningful for PROFESSIONAL_SELF_BILLED — see
  //     InvoiceTypeValue's own doc comment) ---
  /** `true` for `PROFESSIONAL_SELF_BILLED`, `false` for `CUSTOMER_RECEIPT` — derived from `type`, never a second source of truth. */
  selfBilled: boolean;
  /** `null` for `CUSTOMER_RECEIPT` — a customer receipt is not a
   *  self-billing document and never references a
   *  `SelfBillingAuthorizationRecord`. Always set for
   *  `PROFESSIONAL_SELF_BILLED`. */
  selfBillingAuthorizationId: string | null;

  // --- Dates ---
  issueDate: Date | null;
  invoiceDate: Date;
  acceptedAt: Date | null;
  acceptedByUserId: string | null;
  /** Agreement/version the professional's acceptance was recorded
   *  against — copied from the `SelfBillingAuthorizationRecord` active at
   *  acceptance time, so a later authorization re-grant/version bump
   *  never rewrites what an already-accepted invoice actually agreed to. */
  acceptanceAgreementVersion: string | null;

  currency: string;
  lineItems: InvoiceLineItemRecord[];

  // --- Module 78 tax/commission figures — never recomputed, always
  //     copied verbatim from `MaestroYaTaxCalculationResult` at DRAFT
  //     creation time. See this file's own doc comment. ---
  taxableBase: number;
  vatRateBps: number;
  vatAmount: number;
  commissionBase: number;
  commissionRateBps: number;
  commissionAmount: number;
  irpfWithholdingRateBps: number;
  irpfWithholdingAmount: number;
  totalAmount: number;

  /** Deterministic SHA-256 hash of this invoice's own financial fields,
   *  computed once at ISSUE time (see `domain/services/invoice-document.ts`)
   *  — a tamper-evidence checksum only, explicitly NOT a legal electronic
   *  signature (see the module brief's "IMPORTANT LEGAL/ACCOUNTING
   *  LIMITATION" section). `null` before ISSUED. */
  documentHash: string | null;
  /** Bumped defensively on every mutation while still DRAFT — not a
   *  meaningful optimistic-concurrency token on its own (repository
   *  methods use explicit `fromStatuses` CAS instead), kept only so a
   *  persisted row always shows how many times a DRAFT was revised
   *  before submission. */
  version: number;

  cancelledAt: Date | null;
  cancelledByUserId: string | null;
  cancellationReason: string | null;

  createdAt: Date;
  updatedAt: Date;
}

export interface CreateInvoiceDraftData {
  /** Defaults to `PROFESSIONAL_SELF_BILLED` at the repository level if
   *  omitted — see `PrismaInvoiceRepository.createDraft`'s own doc
   *  comment — but every Module 85 call site passes it explicitly. */
  type?: InvoiceTypeValue;
  jobId: string;
  quoteId: string;
  paymentId: string | null;
  professionalProfileId: string | null;
  companyProfileId: string | null;
  customerId: string;
  issuerLegalName: string;
  issuerTaxId: string;
  recipientLegalName: string;
  recipientTaxId: string | null;
  /** `null` for `CUSTOMER_RECEIPT` — see `InvoiceRecord.selfBillingAuthorizationId`'s own doc comment. */
  selfBillingAuthorizationId: string | null;
  invoiceDate: Date;
  currency: string;
  lineItems: InvoiceLineItemInput[];
  taxableBase: number;
  vatRateBps: number;
  vatAmount: number;
  commissionBase: number;
  commissionRateBps: number;
  commissionAmount: number;
  irpfWithholdingRateBps: number;
  irpfWithholdingAmount: number;
  totalAmount: number;
}

export interface AcceptInvoiceData {
  id: string;
  acceptedByUserId: string;
  acceptedAt: Date;
  acceptanceAgreementVersion: string;
  fromStatuses: readonly InvoiceStatusValue[];
}

export interface IssueInvoiceData {
  id: string;
  issueDate: Date;
  /** Called by the repository, exactly once, with the number that was
   *  just allocated INSIDE the same database transaction as the
   *  compare-and-swap status write below — see
   *  `PrismaInvoiceRepository.issue`'s own doc comment for why. A pure
   *  function of `invoiceNumber` (and whatever the invoice's own
   *  already-persisted fields already are) — never performs I/O itself. */
  buildDocumentHash: (invoiceNumber: string) => string;
  fromStatuses: readonly InvoiceStatusValue[];
}

export interface CancelInvoiceData {
  id: string;
  cancelledByUserId: string;
  cancelledAt: Date;
  reason: string;
  fromStatuses: readonly InvoiceStatusValue[];
}

/** Result shape for every compare-and-swap write — same "did this
 *  specific call apply the transition, or did it lose a race / find the
 *  row already elsewhere" convention as `PayoutRepository`'s `markPaid`/
 *  `markFailed`. */
export interface UpdateInvoiceResult {
  applied: boolean;
  record: InvoiceRecord;
}

export interface InvoiceRepository {
  findById(id: string): Promise<InvoiceRecord | null>;
  /** The Job's `PROFESSIONAL_SELF_BILLED` invoice specifically — at most
   *  one non-CANCELLED row of that type per Job (see
   *  `CreateProfessionalInvoiceDraftUseCase`'s own idempotency check and
   *  the migration's partial-unique-index backstop). Every existing call
   *  site (`CheckInvoiceRequiredForPayoutUseCase`, `MarkInvoicePaidUseCase`,
   *  `CreateProfessionalInvoiceDraftUseCase`) means "the professional's
   *  own invoice for this Job" when it calls this method — kept exactly
   *  as that single-type lookup rather than widened, so none of them
   *  need to change for Module 85's `CUSTOMER_RECEIPT` addition. Use
   *  `findByJobIdAndType` for a type-aware lookup. */
  findByJobId(jobId: string): Promise<InvoiceRecord | null>;
  /** Module 85 — Invoicing & Credit Note Activation: same as
   *  `findByJobId` but scoped to a specific `InvoiceTypeValue` — a Job
   *  now legitimately has up to one non-CANCELLED invoice of EACH type
   *  (its `PROFESSIONAL_SELF_BILLED` self-billing invoice and its
   *  `CUSTOMER_RECEIPT`), backed by the migration's
   *  `(jobId, type) WHERE status <> 'CANCELLED'` partial unique index. */
  findByJobIdAndType(jobId: string, type: InvoiceTypeValue): Promise<InvoiceRecord | null>;
  findByInvoiceNumber(invoiceNumber: string): Promise<InvoiceRecord | null>;
  listForProfessional(professionalProfileId: string, options: { limit: number; offset: number }): Promise<InvoiceRecord[]>;

  /** Always inserts a new DRAFT — callers are responsible for the
   *  "one non-cancelled invoice per Job" idempotency check via
   *  `findByJobId` first; the DB-level partial unique index on
   *  `(jobId) WHERE status <> 'CANCELLED'` is the race-safe backstop,
   *  same layered strategy `PayoutRepository.createPending` already
   *  uses for `Payout.jobId`. */
  createDraft(data: CreateInvoiceDraftData): Promise<InvoiceRecord>;

  /** DRAFT -> PENDING_ACCEPTANCE. */
  submitForAcceptance(id: string, fromStatuses: readonly InvoiceStatusValue[]): Promise<UpdateInvoiceResult>;

  /** PENDING_ACCEPTANCE -> ACCEPTED, recording acceptance evidence
   *  atomically with the status write. */
  accept(data: AcceptInvoiceData): Promise<UpdateInvoiceResult>;

  /** ACCEPTED -> ISSUED for `PROFESSIONAL_SELF_BILLED`, DRAFT -> ISSUED
   *  for `CUSTOMER_RECEIPT` (see
   *  `domain/services/invoice-lifecycle.ts`'s own `issuableFromStatus`,
   *  which `IssueInvoiceUseCase` uses to pick `fromStatuses`).
   *
   *  Module 85 — Invoicing & Credit Note Activation: allocates the
   *  invoice number INSIDE the same database transaction as this
   *  method's own compare-and-swap status write, so a lost race (the
   *  invoice was already issued, cancelled, or moved on by a concurrent/
   *  duplicate call by the time this transaction's `UPDATE ... WHERE
   *  status = ANY(fromStatuses)` runs) rolls the number allocation back
   *  too — never burning a number with no invoice attached. This
   *  replaces the previous two-step "allocate via `InvoiceNumberAllocator`,
   *  then separately call `issue()`" sequence Module 79 shipped with (see
   *  MODULE_85_IMPLEMENTATION_REPORT.md for the race this closes); see
   *  `PrismaInvoiceRepository.issue`'s own doc comment for the
   *  transaction mechanics. */
  issue(data: IssueInvoiceData): Promise<UpdateInvoiceResult>;

  /** ISSUED -> PAID. No financial field ever changes here — this only
   *  records that the professional's payout for this invoice's Job has
   *  been financially settled (see `MarkInvoicePaidUseCase`). */
  markPaid(id: string, paidAt: Date, fromStatuses: readonly InvoiceStatusValue[]): Promise<UpdateInvoiceResult>;

  /** DRAFT/PENDING_ACCEPTANCE -> CANCELLED. Never callable once ACCEPTED
   *  or later — see `domain/services/invoice-lifecycle.ts`. */
  cancel(data: CancelInvoiceData): Promise<UpdateInvoiceResult>;
}

/**
 * Concurrency-safe, database-backed document-number allocation — kept as
 * its own port (rather than a method that just returns a random/UUID
 * value) so the numbering strategy (sequential, per-year, never reused,
 * independent of any row's database id — see the module brief's
 * "NUMBERING" section) is swappable/testable independently of
 * `InvoiceRepository`/`CreditNoteRepository` themselves. One allocator
 * backs both document series — see `PrismaDocumentNumberAllocator`'s own
 * doc comment for how the two series share the same atomic-increment
 * mechanism while never sharing (or colliding on) a sequence value.
 *
 * Module 85 — Invoicing & Credit Note Activation: this port is still used
 * directly wherever a number is needed WITHOUT an accompanying
 * compare-and-swap status write to couple it to (there is none such site
 * left in this module today, but the port is kept general rather than
 * folded entirely into `InvoiceRepository.issue`/`CreditNoteRepository.issue`).
 * `PrismaInvoiceRepository.issue`/`PrismaCreditNoteRepository.issue`
 * deliberately do NOT go through this port for their own allocation —
 * they need the allocation and the status write in the SAME transaction
 * (see `issue`'s own doc comment on the invoicing-repository interface),
 * so they call the shared `allocateNextDocumentSequence` helper directly
 * with their own transaction client instead. Both paths execute the
 * identical SQL — see `allocateNextDocumentSequence`'s own doc comment —
 * there is only ever one allocation implementation.
 */
export interface InvoiceNumberAllocator {
  /** Atomically allocates and returns the next invoice number for the
   *  given calendar year (e.g. "INV-2026-000123"), safe under concurrent
   *  callers. Never derived from a timestamp alone and never reused. A
   *  gap in the sequence can still occur if a caller allocates a number
   *  and then never persists anything against it (e.g. a crash between
   *  this call and its own use) — callers that can instead couple
   *  allocation to their own atomic write (as `InvoiceRepository.issue`/
   *  `CreditNoteRepository.issue` now do) should prefer that instead of
   *  calling this port directly, precisely to avoid that gap. */
  allocateNextInvoiceNumber(year: number): Promise<string>;

  /** Same guarantees as `allocateNextInvoiceNumber`, for the separate
   *  credit-note series (e.g. "CN-2026-000045"). */
  allocateNextCreditNoteNumber(year: number): Promise<string>;
}
