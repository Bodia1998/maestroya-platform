-- Module 96 — Referral & Affiliate Production Wiring: real Stripe fee capture.
--
-- Additive enum value only — no existing row is affected. STRIPE_FEE
-- records the actual per-payment Stripe processing fee
-- (balance_transaction.fee), captured once via charge.updated +
-- PaymentGateway.retrieveBalanceTransactionFee, one row per paymentId
-- (enforced by Transaction.idempotencyKey's existing unique constraint,
-- key "stripe-fee:<paymentId>") — see financial-ledger-repository.ts's
-- own doc comment on the TransactionTypeValue union.

ALTER TYPE "TransactionType" ADD VALUE 'STRIPE_FEE';
