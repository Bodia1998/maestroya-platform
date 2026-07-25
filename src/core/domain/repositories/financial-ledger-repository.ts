/**
 * Module 22 — Commission & Financial: repository interface for the
 * existing, previously-unused `Transaction` model (see schema.prisma's own
 * doc comment — "Append-only general ledger... gives a single queryable
 * audit trail independent of which specific table generated it"). This
 * file is the authoritative financial history this module is required to
 * maintain — `Payment.amount`/`Commission.amount`/etc. remain useful
 * per-record snapshots, but a reconstructable history of every money
 * movement always lives here.
 *
 * Append-only by construction: this interface exposes no update/delete
 * method — once a Transaction row is created its `amount`/`type`/
 * `paymentId` etc. are never mutated. A correction is always a new,
 * separate Transaction (e.g. a COMMISSION_REVERSAL row referencing the
 * same Commission), never an edit of the original row — see
 * docs/MODULE_22_COMMISSION_FINANCIAL.md, "Ledger model."
 */

export type TransactionTypeValue =
  | "CHARGE"
  | "REFUND"
  | "PAYOUT"
  | "COMMISSION"
  | "ADJUSTMENT"
  | "LABOR_CHARGE"
  | "MATERIALS_CHARGE"
  | "CUSTOMER_PLATFORM_FEE"
  | "PROFESSIONAL_NET_EARNING"
  | "PLATFORM_REVENUE"
  | "COMMISSION_REVERSAL"
  | "DISPUTE_ADJUSTMENT"
  | "PAYOUT_REVERSAL";

export type TransactionStatusValue = "PENDING" | "COMPLETED" | "FAILED" | "REVERSED";

export interface FinancialTransactionRecord {
  id: string;
  paymentId: string | null;
  payoutId: string | null;
  refundId: string | null;
  commissionId: string | null;
  type: TransactionTypeValue;
  status: TransactionStatusValue;
  /** Signed: positive = inflow to the platform, negative = outflow — same
   *  convention as the underlying Transaction.amount column. */
  amount: number;
  currency: string;
  description: string | null;
  idempotencyKey: string | null;
  createdAt: Date;
}

export interface CreateLedgerEntryData {
  type: TransactionTypeValue;
  status?: TransactionStatusValue;
  amount: number;
  currency?: string;
  paymentId?: string | null;
  payoutId?: string | null;
  refundId?: string | null;
  commissionId?: string | null;
  description?: string | null;
  /** Required in practice (every Module 22 write path supplies one) even
   *  though the column itself is nullable for the pre-existing, still-
   *  unused writers this model was originally scaffolded for. See
   *  FinancialLedgerRepository.findByIdempotencyKey. */
  idempotencyKey: string;
}

export interface FinancialLedgerRepository {
  /**
   * Creates a new, immutable ledger entry. Callers MUST check
   * findByIdempotencyKey first (or rely on the unique constraint and catch
   * the resulting conflict) — this method itself does not silently
   * dedupe.
   */
  create(data: CreateLedgerEntryData): Promise<FinancialTransactionRecord>;
  /** The idempotency guard every Module 22 use case calls before writing —
   *  see docs/MODULE_22_COMMISSION_FINANCIAL.md, "Idempotency." */
  findByIdempotencyKey(idempotencyKey: string): Promise<FinancialTransactionRecord | null>;
  listForPayment(paymentId: string): Promise<FinancialTransactionRecord[]>;
}
