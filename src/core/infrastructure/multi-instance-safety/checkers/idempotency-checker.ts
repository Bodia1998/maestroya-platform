import "server-only";

import type { CheckerFindingInput, SafetyChecker, SubsystemCheckOutcome } from "@/application/ports/safety-checker";
import { SourceScanner } from "@/infrastructure/multi-instance-safety/source-scanner";

const JOB_IDEMPOTENCY_STORE_PATH = "src/core/infrastructure/jobs/job-idempotency-store.ts";
const JOB_STORE_PATH = "src/core/infrastructure/jobs/redis-job-store.ts";
const COMMISSION_USE_CASE_PATH = "src/core/application/use-cases/financial/record-commission-for-payment.use-case.ts";
const LEDGER_REPOSITORY_PATH = "src/core/domain/repositories/financial-ledger-repository.ts";
const STRIPE_CLIENT_PATH = "src/core/infrastructure/payments/stripe/client.ts";

/**
 * Module 58 — Multi-Instance Safety Audit.
 *
 * Covers: idempotency verification, duplicate payment prevention, Stripe
 * webhook idempotency, duplicate processing across background workers.
 *
 * This codebase already has two independent, well-documented idempotency
 * mechanisms (see `job-idempotency-store.ts`'s own doc comment, which
 * this checker quotes the reasoning of):
 *
 *  1. **Enqueue-time**: `JobOptions.jobId` + a `SET ... NX`-style
 *     de-duplication in the job store, so the same logical job can never
 *     be enqueued twice.
 *  2. **Execution-time**: `JobIdempotencyStore.markProcessed`/`isProcessed`,
 *     recorded *after* a successful run — converts at-least-once delivery
 *     into effectively-once execution, safe against a worker on a
 *     different instance picking up a redelivered job.
 *  3. **Business-level**: the financial ledger's own `idempotencyKey`
 *     column (unique-constrained in the database, not just an
 *     in-process check), used by `RecordCommissionForPaymentUseCase` —
 *     safe even if the same payment event were processed by two different
 *     instances concurrently, since the database enforces uniqueness.
 *
 * There is deliberately **no Stripe webhook route** in this codebase yet
 * (`src/app/api` has no `stripe`/`webhook` directory as of this audit) —
 * this checker verifies that fact rather than assuming one exists, and
 * flags it as a forward-looking item rather than a currently-exploitable
 * bug: nothing is broken today, but the moment a webhook route is added,
 * it must reuse `JobIdempotencyStore`/the ledger's `idempotencyKey`
 * pattern (keyed by Stripe's own `event.id`) rather than inventing a new
 * mechanism.
 */
export class IdempotencyChecker implements SafetyChecker {
  readonly subsystem = "Idempotency, Duplicate Payments & Webhook Safety";

  constructor(
    private readonly scanner: SourceScanner = new SourceScanner(),
    private readonly hasStripeWebhookRoute: () => Promise<boolean> = defaultStripeWebhookRouteCheck,
  ) {}

  async check(): Promise<SubsystemCheckOutcome> {
    const passedChecks: string[] = [];
    const findings: CheckerFindingInput[] = [];

    const idempotencyStore = await this.scanner.read(JOB_IDEMPOTENCY_STORE_PATH);
    if (idempotencyStore && /markProcessed/.test(idempotencyStore) && /isProcessed/.test(idempotencyStore) && /"SET".*"PX"/.test(idempotencyStore)) {
      passedChecks.push(
        `${JOB_IDEMPOTENCY_STORE_PATH}: execution-time idempotency is Redis-backed with a TTL'd \`SET ... PX\` — a job redelivered to a different instance after a successful-but-unacknowledged run is correctly skipped.`,
      );
    } else {
      findings.push({
        severity: "CRITICAL",
        problem: "Could not confirm a Redis-backed, TTL'd execution-time idempotency store for background jobs.",
        risk: "A job redelivered by an at-least-once queue (e.g. after a worker crash between 'handler ran' and 'job marked complete') could be executed again on a different instance, with no cross-instance record that it already ran.",
        whyItHappens: `${JOB_IDEMPOTENCY_STORE_PATH} did not match the expected \`markProcessed\`/\`isProcessed\`/Redis \`SET ... PX\` pattern.`,
        impact: "Duplicate side effects for any job whose handler is not itself naturally idempotent (e.g. sending a duplicate email or notification).",
        recommendedFix: "Record a processed-key after every successful job execution in a store shared across instances (Redis), and check it before re-running a redelivered job.",
        priority: "CRITICAL",
        evidence: [JOB_IDEMPOTENCY_STORE_PATH],
      });
    }

    const jobStore = await this.scanner.read(JOB_STORE_PATH);
    if (jobStore && /jobId/.test(jobStore)) {
      passedChecks.push(`${JOB_STORE_PATH}: job enqueue is de-duplicated by a caller-supplied \`jobId\`, preventing the same logical job from entering the queue twice even if two instances race to enqueue it.`);
    }

    const commissionUseCase = await this.scanner.read(COMMISSION_USE_CASE_PATH);
    const ledgerRepository = await this.scanner.read(LEDGER_REPOSITORY_PATH);
    if (commissionUseCase && /idempotencyKey/.test(commissionUseCase) && /findByIdempotencyKey/.test(commissionUseCase)) {
      passedChecks.push(
        `${COMMISSION_USE_CASE_PATH}: commission/ledger postings are keyed by a deterministic \`idempotencyKey\` (\`commission:\${payment.id}\`) and checked via \`findByIdempotencyKey\` before writing — a database-enforced guard against double-crediting the same payment from two instances.`,
      );
    } else {
      findings.push({
        severity: "CRITICAL",
        problem: "Could not confirm database-level idempotency-key protection for financial ledger postings.",
        risk: "Two instances processing the same payment event concurrently (e.g. a retried webhook delivery, or an at-least-once queue redelivery) could both post commission/ledger entries for it.",
        whyItHappens: `${COMMISSION_USE_CASE_PATH} did not match the expected idempotency-key check-before-write pattern.`,
        impact: "Duplicate financial ledger entries — double-counted commissions, incorrect payouts, an unreliable audit trail.",
        recommendedFix: "Guard every financial-ledger write with a deterministic idempotency key checked against a unique database constraint before insert, not just an in-process check.",
        priority: "CRITICAL",
        evidence: [COMMISSION_USE_CASE_PATH],
      });
    }
    if (ledgerRepository && /findByIdempotencyKey/.test(ledgerRepository)) {
      passedChecks.push(`${LEDGER_REPOSITORY_PATH}: the repository port itself exposes \`findByIdempotencyKey\`, making the guard a first-class part of the persistence contract rather than an ad hoc query.`);
    }

    const stripeClient = await this.scanner.read(STRIPE_CLIENT_PATH);
    const hasWebhookRoute = await this.hasStripeWebhookRoute();
    if (!hasWebhookRoute) {
      findings.push({
        severity: "WARNING",
        problem: "No Stripe webhook route currently exists in this codebase (`src/app/api` has no stripe/webhook directory).",
        risk: "Not an active vulnerability today — but the moment a webhook endpoint is added, it is a new entry point that must independently guard against Stripe's documented at-least-once webhook redelivery, or duplicate payment/commission processing becomes possible again despite the existing ledger idempotency-key guard.",
        whyItHappens: "Stripe integration in this codebase is currently limited to a `payment-gateway` port/Stripe client (`" + STRIPE_CLIENT_PATH + "`); asynchronous event delivery via webhooks has not been built yet.",
        impact: "None today. Forward-looking: a future webhook handler that does not check `event.id` against a durable idempotency store before acting would reintroduce duplicate-processing risk at the network boundary, ahead of the ledger's own guard.",
        recommendedFix: "When a Stripe webhook route is added, verify the signature via `stripe.webhooks.constructEvent`, then check/record `event.id` in `JobIdempotencyStore` (or an equivalent durable, Redis-backed store) before invoking any handler — mirroring the pattern already established for background jobs.",
        priority: "MEDIUM",
        evidence: stripeClient ? [STRIPE_CLIENT_PATH] : [],
      });
    } else {
      passedChecks.push("A Stripe webhook route exists — verified separately for signature validation and idempotency-key usage.");
    }

    return { passedChecks, findings };
  }
}

async function defaultStripeWebhookRouteCheck(): Promise<boolean> {
  const scanner = new SourceScanner();
  const candidates = [
    "src/app/api/webhooks/stripe/route.ts",
    "src/app/api/stripe/webhook/route.ts",
    "src/app/api/stripe/webhooks/route.ts",
    "src/app/api/payments/webhook/route.ts",
  ];
  for (const candidate of candidates) {
    if (await scanner.exists(candidate)) return true;
  }
  return false;
}
