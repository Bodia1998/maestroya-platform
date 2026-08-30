import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import { roundToCents } from "@/domain/services/money";
import { StripeTransferError } from "@/domain/errors/domain-error";
import type { JobRepository } from "@/domain/repositories/job-repository";
import type { PaymentRepository } from "@/domain/repositories/payment-repository";
import type { JobCompletionConfirmationRepository } from "@/domain/repositories/job-completion-confirmation-repository";
import type { DisputeRepository } from "@/domain/repositories/dispute-repository";
import type { CommissionRepository } from "@/domain/repositories/commission-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { CompanyRepository } from "@/domain/repositories/company-repository";
import type { TrustAutomatedActionRepository } from "@/domain/repositories/trust-automated-action-repository";
import type { PayoutRecord, PayoutRepository } from "@/domain/repositories/payout-repository";
import type { CheckPayoutEligibilityUseCase } from "@/application/use-cases/verification/check-payout-eligibility.use-case";
import type {
  ResolvePayoutDestinationUseCase,
  ResolvedPayoutDestination,
} from "@/application/use-cases/financial/resolve-payout-destination.use-case";
import type { RecordCommissionForPaymentUseCase } from "@/application/use-cases/financial/record-commission-for-payment.use-case";
import type { StripeTransferGateway } from "@/application/ports/stripe-transfer-gateway";
import type { CheckInvoiceRequiredForPayoutUseCase } from "@/application/use-cases/invoicing/check-invoice-required-for-payout.use-case";
import type { DistributedLock } from "@/application/ports/distributed-lock";
import type { EventBus } from "@/application/ports/event-bus";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";
import { publishDomainEvent } from "@/application/services/events/publish-domain-event";
import { ProfessionalPayoutExecuted } from "@/domain/events/professional-payout-executed";
import { ProfessionalPayoutFailed } from "@/domain/events/professional-payout-failed";
import { logger } from "@/infrastructure/observability/logger";

/** How long a single execution attempt may hold the per-Job payout lock —
 *  comfortably longer than a `RecordCommissionForPaymentUseCase` call plus
 *  one Stripe API round trip is expected to take. A crashed holder
 *  self-expires after this, per `DistributedLock.withLock`'s own doc
 *  comment — never a permanently stuck Job. */
const LOCK_TTL_MS = 30_000;

/** Statuses from which a payout attempt is still allowed to run — a fresh
 *  Job (no row yet), a previously failed attempt (retry), or a row this
 *  same process left `PENDING`/`IN_TRANSIT` after crashing between the
 *  Stripe call and the local write (see this class's own "network
 *  response lost" doc comment). `PAID`/`CANCELLED` are excluded — both are
 *  handled as an early return before this matters. */
const RETRYABLE_PAYOUT_STATUSES = ["PENDING", "IN_TRANSIT", "FAILED"] as const;

/**
 * Module 76 — Professional Payout Execution.
 *
 * The ONE place that actually executes a Stripe Transfer paying a
 * professional or company for a Job — the module `PaymentReleaseApproved`'s
 * own doc comment (Module 66) has always named as "the exact signal a
 * future Stripe Connect payout module is expected to subscribe to."
 * Subscribed via `ExecutePayoutOnReleaseApprovedSubscriber`
 * (`execute-payout-on-release-approved.subscriber.ts`), and safe to call
 * directly (an admin retry action, a reconciliation sweep) for the exact
 * same reason every step below is re-derived from authoritative state
 * rather than trusted from the caller.
 *
 * ## Reuses every existing module, duplicates none
 * - Module 66 (`JobCompletionConfirmationRepository.releaseStatus`) is the
 *   single release gate — never re-derived.
 * - Module 22/64 (`RecordCommissionForPaymentUseCase` +
 *   `CommissionRepository`) is the single source of the payout amount —
 *   `Payment.amount` minus the already-recorded (frozen at recording time)
 *   `Commission.amount`, never recomputed from live commission rates at
 *   payout time (which could drift from what was actually recorded/
 *   ledgered — see this class's own "amount" step below).
 * - Module 75 (`CheckPayoutEligibilityUseCase` +
 *   `ResolvePayoutDestinationUseCase`) is the single eligibility/
 *   destination-resolution mechanism — re-run fresh, immediately before
 *   the transfer, never assumed still valid from an earlier check.
 * - Module 65 (`TrustAutomatedActionRepository`) is the single payout-hold
 *   mechanism — the same `PAYOUT_HOLD` check
 *   `EvaluatePaymentReleaseUseCase` already runs.
 *
 * ## Idempotency / concurrency (the module's core safety requirement)
 * Three independent layers, each sufficient on its own, so no single
 * infrastructure failure (a crashed lock service, a slow database) can
 * ever let two Stripe Transfers exist for the same Job:
 *
 *   1. **`DistributedLock`** (`payout:execute:<jobId>`) serializes
 *      concurrent executions for the same Job within/across process
 *      instances — the fast, cooperative layer.
 *   2. **`Payout.jobId`'s database-unique constraint**
 *      (`PayoutRepository.createPending`, an upsert-or-return-existing) is
 *      the authoritative backstop if the lock is ever unavailable/expired:
 *      two callers that both reach `createPending` for the same Job
 *      converge on the exact same row, never two.
 *   3. **Stripe's own idempotency key** (`Payout.idempotencyKey`, reused
 *      unchanged across every retry of the same Payout row) is what
 *      specifically survives the "Stripe accepted the transfer, the
 *      network response was lost before this process could persist
 *      `stripeTransferId`, a retry follows" scenario the module brief
 *      calls out: the retried `stripe.transfers.create` call with the same
 *      key returns Stripe's *original* Transfer, never a second one — this
 *      use case then simply persists that same id, converging on the
 *      already-successful transfer rather than creating another.
 *
 * A Payout already `PAID` is always a no-op read — this method never
 * calls Stripe a second time for an already-successful payout, regardless
 * of how many times or how concurrently it's invoked.
 *
 * ## Safe to retry
 * Every step re-derives its input from authoritative, already-persisted
 * state (the Job, the Payment, the release decision, live eligibility, a
 * fresh destination resolution) — nothing here is only valid "the first
 * time." A caller may call `execute(jobId)` again after any failure
 * (business-rule failure, Stripe failure, process crash) and this class
 * will either converge on the already-successful transfer (see above) or
 * make a fresh, fully-revalidated attempt.
 */
export class ExecuteProfessionalPayoutUseCase {
  constructor(
    private readonly jobs: JobRepository,
    private readonly payments: PaymentRepository,
    private readonly completionConfirmations: JobCompletionConfirmationRepository,
    private readonly disputes: DisputeRepository,
    private readonly commissions: CommissionRepository,
    private readonly recordCommission: RecordCommissionForPaymentUseCase,
    private readonly professionals: ProfessionalRepository,
    private readonly companies: CompanyRepository,
    private readonly trustAutomatedActions: TrustAutomatedActionRepository,
    private readonly payoutEligibility: CheckPayoutEligibilityUseCase,
    private readonly destinationResolver: ResolvePayoutDestinationUseCase,
    private readonly payouts: PayoutRepository,
    private readonly transferGateway: StripeTransferGateway,
    private readonly lock: DistributedLock,
    private readonly eventBus: EventBus,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
    // Module 79 — Invoicing & Credit Notes: OPTIONAL integration point —
    // see `CheckInvoiceRequiredForPayoutUseCase`'s own doc comment. Left
    // undefined, this class's behavior is byte-for-byte identical to
    // before Module 79 existed (no invoice check is ever performed) —
    // Module 76's own logic, tests, and every existing caller are
    // unmodified. When wired (see `payments/compose.ts`), a payout is
    // blocked until the job's invoice satisfies
    // `satisfiesPayoutInvoicePrerequisite` (ISSUED or PAID).
    private readonly invoiceGate?: CheckInvoiceRequiredForPayoutUseCase,
    private readonly requireInvoiceForPayout = false,
  ) {}

  async execute(jobId: string): Promise<PayoutRecord> {
    // Fast path — never even takes the lock for a Job whose payout is
    // already durably PAID (the overwhelmingly common case for a retried
    // call: a subscriber redelivery, a duplicate admin click, a
    // reconciliation sweep re-visiting every RELEASE_APPROVED job).
    const existing = await this.payouts.findByJobId(jobId);
    if (existing?.status === "PAID") {
      return existing;
    }
    if (existing?.status === "CANCELLED") {
      // Terminal — a cancelled Payout (Module 77's reversal territory)
      // must never be silently re-attempted by this module.
      throw new ValidationError(`This job's payout was cancelled and cannot be re-executed (payout ${existing.id}).`);
    }

    const result = await this.lock.withLock(`payout:execute:${jobId}`, LOCK_TTL_MS, () => this.executeLocked(jobId));

    if (result === null) {
      // Another execution is already in flight for this exact Job right
      // now (a genuinely concurrent call, not a retry of a finished one —
      // see the fast path above). The DB-level unique constraint on
      // Payout.jobId means that in-flight execution is the only one that
      // can ever succeed; this caller has nothing useful of its own to
      // return and must not fabricate a result.
      const current = await this.payouts.findByJobId(jobId);
      if (current) return current;
      throw new ValidationError(`A payout execution is already in progress for job "${jobId}" — try again shortly.`);
    }

    return result;
  }

  private async executeLocked(jobId: string): Promise<PayoutRecord> {
    const job = await this.jobs.findById(jobId);
    if (!job) {
      throw new NotFoundError("Job", jobId);
    }

    // --- Module 66 gate: the single authoritative release decision ---
    const confirmation = await this.completionConfirmations.findByJobId(jobId);
    if (!confirmation || confirmation.releaseStatus !== "RELEASE_APPROVED") {
      throw new ValidationError(
        "This job's payment release has not reached RELEASE_APPROVED — a payout can only be executed once Module 66's release decision approves it.",
      );
    }

    if (job.status === "CANCELLED") {
      throw new ValidationError("This job was cancelled — no payout can be executed.");
    }

    // --- Payment must be CAPTURED — the authoritative money-in-hand check ---
    const paymentsForJob = await this.payments.findByJobId(jobId);
    const payment = paymentsForJob.find((p) => p.status === "CAPTURED") ?? null;
    if (!payment) {
      const partiallyRefunded = paymentsForJob.some((p) => p.status === "PARTIALLY_REFUNDED");
      throw new ValidationError(
        partiallyRefunded
          ? "This job's payment has an active partial refund — payout execution requires Module 77 reconciliation first."
          : "This job has no CAPTURED payment — a payout can only be executed once the customer payment has been captured.",
      );
    }

    // --- No blocking dispute (re-checked fresh, not trusted from the
    //     Module 66 decision that may have been recorded earlier) ---
    const disputesForJob = await this.disputes.listByJobId(jobId);
    if (disputesForJob.some((d) => d.status !== "CLOSED")) {
      throw new ValidationError("This job has an open dispute — payout execution is blocked until it is closed.");
    }

    // --- Resolve the owner and re-run eligibility + payout-hold checks fresh ---
    const owner = await this.resolveOwner(job);

    const eligibility =
      owner.type === "PROFESSIONAL"
        ? await this.payoutEligibility.execute(owner.professionalProfileId)
        : await this.payoutEligibility.executeForCompany(owner.companyProfileId);
    if (!eligibility.eligible) {
      throw new ValidationError(`Payout eligibility check failed immediately before execution: ${eligibility.reason}`);
    }

    const ownerUserId = await this.resolveOwnerUserId(owner);
    if (ownerUserId) {
      const activeHolds = await this.trustAutomatedActions.listActiveForUser(ownerUserId, "PAYOUT_HOLD");
      if (activeHolds.length > 0) {
        throw new ValidationError("An active payout hold blocks this payout from being executed.");
      }
    }

    // --- Module 79 — Invoicing & Credit Notes: optional invoice-state
    //     prerequisite, re-checked fresh (never cached), same "gate
    //     immediately before the transfer, not earlier" placement as
    //     every other check above. A no-op when `invoiceGate` was never
    //     wired — see this class's own constructor doc comment. ---
    if (this.invoiceGate) {
      const invoiceEligibility = await this.invoiceGate.execute(jobId, this.requireInvoiceForPayout);
      if (!invoiceEligibility.eligible) {
        throw new ValidationError(`Payout blocked by invoice prerequisite: ${invoiceEligibility.reason}`);
      }
    }

    // --- Resolve the Stripe Connect destination (Module 75) — never
    //     accepted from any caller input ---
    const destination = await this.destinationResolver.execute(
      owner.type === "PROFESSIONAL"
        ? { type: "PROFESSIONAL", professionalProfileId: owner.professionalProfileId }
        : { type: "COMPANY", companyProfileId: owner.companyProfileId },
      true,
    );
    const stripeAccountId = destination.account.stripeExpressAccountId;
    if (!stripeAccountId) {
      throw new ValidationError("This payout destination has no Stripe Connect account yet — cannot execute a transfer.");
    }
    if (!destination.account.stripeChargesEnabled) {
      // See StripeAccountStatusResult.transfersActive's own doc comment
      // (application/ports/stripe-connect-gateway.ts) — this mirrors
      // ProcessStripeConnectWebhookUseCase's own write of the *transfers*
      // capability onto `stripeChargesEnabled`, not the literal Stripe
      // `charges_enabled` field.
      throw new ValidationError("This Stripe Connect account cannot currently receive transfers.");
    }

    // --- Idempotency: create (or re-read) the PENDING Payout row for this Job ---
    const idempotencyKey = `payout:${jobId}`;
    const professionalProfileId = owner.type === "PROFESSIONAL" ? owner.professionalProfileId : null;
    const companyProfileId = owner.type === "COMPANY" ? owner.companyProfileId : null;

    // --- Authoritative amount: Payment.amount minus the already-recorded,
    //     frozen Commission.amount (never a live re-calculation — see this
    //     class's own doc comment) ---
    // RecordCommissionForPaymentUseCase is itself idempotent (returns the
    // existing Commission unchanged if one was already recorded, e.g. by
    // the PaymentCaptured subscriber) — calling it here also closes the
    // gap where release approval happens strictly after capture (the
    // normal order), the case that subscriber's own doc comment defers to
    // "a later run once the job completes."
    const commission = await this.recordCommission.execute(payment.id);
    const amount = roundToCents(payment.amount - commission.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new ValidationError(`Computed payout amount (${amount}) is not a valid positive amount.`);
    }

    let payoutRow = await this.payouts.findByJobId(jobId);
    if (!payoutRow) {
      payoutRow = await this.payouts.createPending({
        jobId,
        paymentId: payment.id,
        professionalProfileId,
        companyProfileId,
        amount,
        currency: payment.currency,
        idempotencyKey,
      });
    }

    if (payoutRow.status === "PAID") {
      // Lost a race with a concurrent execution that finished between
      // this method's own fast-path check and acquiring the lock.
      return payoutRow;
    }
    if (payoutRow.status === "CANCELLED") {
      throw new ValidationError(`This job's payout was cancelled and cannot be re-executed (payout ${payoutRow.id}).`);
    }

    try {
      const transfer = await this.transferGateway.createTransfer({
        destinationStripeAccountId: stripeAccountId,
        amount: payoutRow.amount,
        currency: payoutRow.currency,
        idempotencyKey: payoutRow.idempotencyKey ?? idempotencyKey,
        metadata: { payoutId: payoutRow.id, jobId },
      });

      const { record } = await this.payouts.markPaid({
        id: payoutRow.id,
        stripeTransferId: transfer.stripeTransferId,
        fromStatuses: RETRYABLE_PAYOUT_STATUSES,
      });

      if (record.status === "PAID") {
        await publishDomainEvent(
          this.eventBus,
          new ProfessionalPayoutExecuted(
            record.id,
            jobId,
            payment.id,
            record.professionalProfileId,
            record.companyProfileId,
            record.amount,
            record.currency,
            record.stripeTransferId ?? transfer.stripeTransferId,
          ),
          this.failureReporter,
        );
      }

      return record;
    } catch (error) {
      const message = error instanceof StripeTransferError ? error.message : error instanceof Error ? error.message : "Unknown payout execution failure.";
      const retryable = error instanceof StripeTransferError ? error.retryable : false;

      const { record } = await this.payouts.markFailed({
        id: payoutRow.id,
        failureReason: message,
        fromStatuses: RETRYABLE_PAYOUT_STATUSES,
      });

      logger.error("professional_payout_execution_failed", {
        jobId,
        payoutId: payoutRow.id,
        retryable,
        error: message,
      });

      await publishDomainEvent(
        this.eventBus,
        new ProfessionalPayoutFailed(record.id, jobId, message, retryable),
        this.failureReporter,
      );

      throw error;
    }
  }

  private async resolveOwner(
    job: { professionalProfileId: string | null; companyProfileId: string | null },
  ): Promise<{ type: "PROFESSIONAL"; professionalProfileId: string } | { type: "COMPANY"; companyProfileId: string }> {
    if (job.professionalProfileId) {
      return { type: "PROFESSIONAL", professionalProfileId: job.professionalProfileId };
    }
    if (job.companyProfileId) {
      return { type: "COMPANY", companyProfileId: job.companyProfileId };
    }
    throw new ValidationError("This job has neither a professional nor a company assigned — cannot execute a payout.");
  }

  private async resolveOwnerUserId(
    owner: { type: "PROFESSIONAL"; professionalProfileId: string } | { type: "COMPANY"; companyProfileId: string },
  ): Promise<string | null> {
    if (owner.type === "PROFESSIONAL") {
      const professional = await this.professionals.findById(owner.professionalProfileId);
      return professional?.userId ?? null;
    }
    const company = await this.companies.findById(owner.companyProfileId);
    return company?.ownerUserId ?? null;
  }
}

// Re-exported only so call sites/tests can reference the resolved
// destination's own type without importing Module 75's use case module
// directly for that purpose alone.
export type { ResolvedPayoutDestination };
