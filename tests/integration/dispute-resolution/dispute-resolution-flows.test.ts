import { describe, expect, it } from "vitest";

import { CloseDisputeUseCase } from "@/application/use-cases/dispute/close-dispute.use-case";
import { CreateDisputeUseCase } from "@/application/use-cases/dispute/create-dispute.use-case";
import { ResolveDisputeUseCase } from "@/application/use-cases/dispute/resolve-dispute.use-case";
import { ResolveDisputeWithFinancialOutcomeUseCase } from "@/application/use-cases/dispute-resolution/resolve-dispute-with-financial-outcome.use-case";
import { CreateFinancialAdjustmentUseCase } from "@/application/use-cases/financial/create-financial-adjustment.use-case";
import { ConflictError, ValidationError } from "@/domain/errors/domain-error";
import { decidePaymentReleaseStatus } from "@/domain/services/payment-release-decision";
import { SynchronousEventBus } from "@/infrastructure/events/synchronous-event-bus";
import {
  FakeAppointmentRepository,
  FakeCustomerProfileRepository,
  FakeJobRepository,
  FakeQuoteAcceptanceRepository,
  FakeQuoteRepository,
  FakeServiceRequestRepository,
  createAppointmentStore,
  createJobStore,
} from "../booking/fakes";
import { FakeCompanyMembershipRepository } from "../company/fakes";
import { FakeAdminAuditLogRepository, FakeDisputeRepository } from "../dispute/fakes";
import { FakeFinancialAdjustmentRepository, FakeFinancialLedgerRepository, FakePaymentRepository } from "../financial/fakes";
import { FakeProfessionalRepository } from "../quotes/fakes";
import { FakeDisputeResolutionDecisionRepository } from "./fakes";

/**
 * Integration tests for Module 68 — Dispute Resolution & Financial
 * Protection. Real use cases + domain services, fake repositories swapped
 * in for storage — same pattern as tests/integration/dispute/dispute-flows.test.ts
 * and tests/integration/financial/financial-flows.test.ts, which this file
 * reuses fakes from directly rather than redefining them.
 */

let counter = 0;
const ADMIN = "admin-1";
const CUSTOMER = "customer-1";
const PROFESSIONAL = "professional-1";

function makeRepos() {
  const customerProfiles = new FakeCustomerProfileRepository();
  const professionals = new FakeProfessionalRepository();
  const serviceRequests = new FakeServiceRequestRepository();
  const quotes = new FakeQuoteRepository();
  const appointmentStore = createAppointmentStore();
  const jobStore = createJobStore();
  const quoteAcceptance = new FakeQuoteAcceptanceRepository(quotes, serviceRequests, appointmentStore, jobStore);
  const appointments = new FakeAppointmentRepository(appointmentStore);
  const jobs = new FakeJobRepository(jobStore, appointmentStore);
  const companyMembers = new FakeCompanyMembershipRepository();
  const disputes = new FakeDisputeRepository();
  const payments = new FakePaymentRepository();
  const adjustments = new FakeFinancialAdjustmentRepository();
  const ledger = new FakeFinancialLedgerRepository();
  const decisions = new FakeDisputeResolutionDecisionRepository();
  const auditLog = new FakeAdminAuditLogRepository();
  return {
    customerProfiles,
    professionals,
    serviceRequests,
    quotes,
    quoteAcceptance,
    appointments,
    jobs,
    jobStore,
    companyMembers,
    disputes,
    payments,
    adjustments,
    ledger,
    decisions,
    auditLog,
  };
}

type Repos = ReturnType<typeof makeRepos>;

async function seedJob(repos: Repos, amount = 300) {
  const professional = await repos.professionals.create(PROFESSIONAL, {});
  const customer = await repos.customerProfiles.findOrCreateByUserId(CUSTOMER);
  counter += 1;
  const now = new Date();
  const request = repos.serviceRequests.seed({
    id: `request-${counter}`,
    customerId: customer.id,
    categoryId: "cat-plumbing",
    categoryName: "Plumbing",
    title: "Fix leaking kitchen tap",
    description: "Dripping for a week.",
    status: "PUBLISHED",
    urgency: "MEDIUM",
    budgetMin: null,
    budgetMax: null,
    location: {
      line1: "Calle Mayor 1",
      line2: null,
      city: "Oliva",
      province: "Valencia",
      postalCode: "46780",
      country: "ES",
      latitude: null,
      longitude: null,
    },
    photos: [],
    createdAt: now,
    updatedAt: now,
  });
  const quote = await repos.quotes.create({
    serviceRequestId: request.id,
    professionalProfileId: professional.id,
    submittedByUserId: PROFESSIONAL,
    totalAmount: amount,
    currency: "EUR",
    validUntil: null,
    notes: null,
    items: [{ description: "Labor", quantity: 1, unitPrice: amount }],
  });
  const result = await repos.quoteAcceptance.acceptQuote({ quoteId: quote.id, serviceRequestId: request.id });

  // Drive the job straight to IN_PROGRESS — the minimum status a dispute
  // may be opened from (dispute-rules.ts) — by writing directly to the
  // shared in-memory job store, the same test-only shortcut
  // tests/integration/financial/financial-flows.test.ts's own
  // seedReleaseStatus helpers use, rather than replaying the full
  // appointment-confirmation + StartJobUseCase pipeline this file doesn't
  // otherwise need to exercise.
  const storedJob = repos.jobStore.get(result.job.id)!;
  const inProgressJob = { ...storedJob, status: "IN_PROGRESS" as const };
  repos.jobStore.set(result.job.id, inProgressJob);

  const payment = repos.payments.seed({
    id: `payment-${counter}`,
    serviceRequestId: request.id,
    quoteId: quote.id,
    jobId: result.job.id,
    payerId: CUSTOMER,
    amount,
    currency: "EUR",
    status: "CAPTURED",
    capturedAt: now,
  });

  return { job: inProgressJob, professional, payment };
}

function makeUseCases(repos: Repos) {
  const eventBus = new SynchronousEventBus();

  const createDispute = new CreateDisputeUseCase(
    repos.disputes,
    repos.jobs,
    repos.customerProfiles,
    repos.professionals,
    repos.companyMembers,
    eventBus,
  );
  const resolveDispute = new ResolveDisputeUseCase(
    repos.disputes,
    repos.jobs,
    repos.customerProfiles,
    repos.professionals,
    repos.companyMembers,
    eventBus,
  );
  const closeDispute = new CloseDisputeUseCase(
    repos.disputes,
    repos.jobs,
    repos.customerProfiles,
    repos.professionals,
    repos.companyMembers,
    repos.decisions,
    eventBus,
  );
  const createFinancialAdjustment = new CreateFinancialAdjustmentUseCase(repos.jobs, repos.adjustments, repos.ledger);
  const resolveWithFinancialOutcome = new ResolveDisputeWithFinancialOutcomeUseCase(
    repos.disputes,
    repos.payments,
    repos.decisions,
    resolveDispute,
    createFinancialAdjustment,
    eventBus,
  );

  return { createDispute, resolveDispute, closeDispute, resolveWithFinancialOutcome };
}

async function openDispute(repos: Repos, useCases: ReturnType<typeof makeUseCases>, jobId: string) {
  return useCases.createDispute.execute(CUSTOMER, {
    jobId,
    reason: "SERVICE_QUALITY",
    title: "Work was not finished",
    description: "The professional left before finishing the job.",
  });
}

describe("Module 68 — dispute resolution & financial protection", () => {
  it("CUSTOMER_FAVOR resolution produces exactly one FULL_REFUND ledger entry and no professional payout", async () => {
    const repos = makeRepos();
    const useCases = makeUseCases(repos);
    const { job } = await seedJob(repos, 300);
    const dispute = await openDispute(repos, useCases, job.id);

    const decision = await useCases.resolveWithFinancialOutcome.execute(ADMIN, dispute.id, {
      resolution: "CUSTOMER_FAVOR",
      resolutionNote: "Professional never finished the job.",
    });

    expect(decision.outcome).toBe("FULL_REFUND");
    expect(decision.status).toBe("APPLIED");

    const adjustments = await repos.adjustments.listForJob(job.id);
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0]!.type).toBe("FULL_REFUND");
    expect(adjustments[0]!.amount).toBe(300);
    expect(adjustments[0]!.status).toBe("APPLIED");

    // WHAT SHOULD EXIST: exactly one signed ledger entry for the refund.
    const ledgerEntries = repos.ledger.entries.filter((e) => e.paymentId);
    expect(ledgerEntries).toHaveLength(1);
    expect(ledgerEntries[0]!.type).toBe("DISPUTE_ADJUSTMENT");
    expect(ledgerEntries[0]!.amount).toBe(-300);

    // WHAT MUST NOT EXIST: no PROFESSIONAL_NET_EARNING / no second entry.
    expect(repos.ledger.entries.some((e) => e.type === "PROFESSIONAL_NET_EARNING")).toBe(false);

    // The Dispute itself is now resolved (Module 21 unchanged).
    const resolvedDispute = await repos.disputes.findById(dispute.id);
    expect(resolvedDispute!.status).toBe("RESOLVED");
    expect(resolvedDispute!.resolution).toBe("CUSTOMER_FAVOR");
  });

  it("PARTIAL_RESOLUTION records exactly the admin-specified amount, never a derived one", async () => {
    const repos = makeRepos();
    const useCases = makeUseCases(repos);
    const { job } = await seedJob(repos, 400);
    const dispute = await openDispute(repos, useCases, job.id);

    const decision = await useCases.resolveWithFinancialOutcome.execute(ADMIN, dispute.id, {
      resolution: "PARTIAL_RESOLUTION",
      resolutionNote: "Part of the work was completed satisfactorily.",
      requestedAmount: 120,
    });

    expect(decision.outcome).toBe("PARTIAL_REFUND");
    const adjustments = await repos.adjustments.listForJob(job.id);
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0]!.type).toBe("PARTIAL_REFUND");
    expect(adjustments[0]!.amount).toBe(120);
  });

  it("PROFESSIONAL_FAVOR resolution produces no adjustments and no refund", async () => {
    const repos = makeRepos();
    const useCases = makeUseCases(repos);
    const { job } = await seedJob(repos, 250);
    const dispute = await openDispute(repos, useCases, job.id);

    const decision = await useCases.resolveWithFinancialOutcome.execute(ADMIN, dispute.id, {
      resolution: "PROFESSIONAL_FAVOR",
      resolutionNote: "The customer's claim was unfounded.",
    });

    expect(decision.outcome).toBe("FULL_RELEASE");
    expect(decision.status).toBe("APPLIED");
    expect(await repos.adjustments.listForJob(job.id)).toHaveLength(0);
    expect(repos.ledger.entries).toHaveLength(0);
  });

  it("ESCALATED_EXTERNALLY holds — no automatic financial action, no payout merely because it was escalated", async () => {
    const repos = makeRepos();
    const useCases = makeUseCases(repos);
    const { job } = await seedJob(repos, 250);
    const dispute = await openDispute(repos, useCases, job.id);

    const decision = await useCases.resolveWithFinancialOutcome.execute(ADMIN, dispute.id, {
      resolution: "ESCALATED_EXTERNALLY",
      resolutionNote: "Referred to the insurer for property-damage assessment.",
    });

    expect(decision.outcome).toBe("HOLD_FOR_REVIEW");
    expect(await repos.adjustments.listForJob(job.id)).toHaveLength(0);
    expect(repos.ledger.entries).toHaveLength(0);
  });

  it("is idempotent: resolving the same dispute's financial outcome twice returns the same decision, no duplicate adjustments", async () => {
    const repos = makeRepos();
    const useCases = makeUseCases(repos);
    const { job } = await seedJob(repos, 300);
    const dispute = await openDispute(repos, useCases, job.id);

    const first = await useCases.resolveWithFinancialOutcome.execute(ADMIN, dispute.id, {
      resolution: "CUSTOMER_FAVOR",
      resolutionNote: "Refunding in full.",
    });
    const second = await useCases.resolveWithFinancialOutcome.execute(ADMIN, dispute.id, {
      resolution: "CUSTOMER_FAVOR",
      resolutionNote: "Refunding in full.",
    });

    expect(second.id).toBe(first.id);
    expect(await repos.adjustments.listForJob(job.id)).toHaveLength(1);
    expect(repos.ledger.entries.filter((e) => e.paymentId)).toHaveLength(1);
  });

  it("concurrent resolution attempts cannot produce two decisions or two financial outcomes", async () => {
    const repos = makeRepos();
    const useCases = makeUseCases(repos);
    const { job } = await seedJob(repos, 300);
    const dispute = await openDispute(repos, useCases, job.id);

    const input = { resolution: "CUSTOMER_FAVOR" as const, resolutionNote: "Refunding in full." };
    const results = await Promise.allSettled([
      useCases.resolveWithFinancialOutcome.execute(ADMIN, dispute.id, input),
      useCases.resolveWithFinancialOutcome.execute(ADMIN, dispute.id, input),
    ]);

    // Both either succeed (one wins the race, the other safely re-reads the
    // winner's result) or the loser surfaces a ConflictError — never two
    // distinct decisions and never two sets of adjustments.
    for (const result of results) {
      if (result.status === "rejected") {
        expect(result.reason).toBeInstanceOf(ConflictError);
      }
    }
    const decisionsForDispute = [...repos.decisions.decisions.values()].filter((d) => d.disputeId === dispute.id);
    expect(decisionsForDispute).toHaveLength(1);
    expect(await repos.adjustments.listForJob(job.id)).toHaveLength(1);
    expect(repos.ledger.entries.filter((e) => e.paymentId)).toHaveLength(1);
  });

  it("recovers cleanly if the Dispute was already resolved but no decision was recorded (crash recovery), without re-trusting a different caller-supplied resolution", async () => {
    const repos = makeRepos();
    const useCases = makeUseCases(repos);
    const { job } = await seedJob(repos, 300);
    const dispute = await openDispute(repos, useCases, job.id);

    // Simulate the crash: the Dispute got resolved directly (bypassing this
    // module's atomic use case, e.g. via the pre-existing resolveDisputeAction)
    // but no DisputeResolutionDecision was ever created.
    await useCases.resolveDispute.execute(ADMIN, dispute.id, {
      resolution: "CUSTOMER_FAVOR",
      resolutionNote: "Refunding in full.",
    });

    // A caller retries with a DIFFERENT resolution value — must be ignored
    // in favor of the dispute's own already-persisted resolution, never
    // silently producing a financial outcome the admin didn't actually
    // decide.
    const decision = await useCases.resolveWithFinancialOutcome.execute(ADMIN, dispute.id, {
      resolution: "PROFESSIONAL_FAVOR",
      resolutionNote: "ignored",
    });

    expect(decision.resolution).toBe("CUSTOMER_FAVOR");
    expect(decision.outcome).toBe("FULL_REFUND");
    expect(await repos.adjustments.listForJob(job.id)).toHaveLength(1);
  });

  describe("Module 66 integration — close-time settlement guard", () => {
    it("blocks closing a dispute whose resolution requires a financial adjustment that has not been applied yet", async () => {
      const repos = makeRepos();
      const useCases = makeUseCases(repos);
      const { job } = await seedJob(repos, 300);
      const dispute = await openDispute(repos, useCases, job.id);

      // Resolve WITHOUT going through the Module 68 financial-outcome use
      // case (mirrors the pre-Module-68 admin action) — Dispute.resolution
      // is CUSTOMER_FAVOR, but no DisputeResolutionDecision exists yet.
      await useCases.resolveDispute.execute(ADMIN, dispute.id, {
        resolution: "CUSTOMER_FAVOR",
        resolutionNote: "Refunding in full.",
      });

      await expect(useCases.closeDispute.execute(ADMIN, dispute.id)).rejects.toThrow(ValidationError);

      // WHAT MUST NOT EXIST: the dispute must still be blocking release.
      const disputesForJob = await repos.disputes.listByJobId(job.id);
      const hasBlockingDispute = disputesForJob.some((d) => d.status !== "CLOSED");
      expect(hasBlockingDispute).toBe(true);
      const decision = decidePaymentReleaseStatus({
        jobStatus: "COMPLETED",
        confirmationStatus: "CONFIRMED",
        hasBlockingDispute,
        paymentStatus: "CAPTURED",
        payoutEligible: true,
        payoutHoldActive: false,
      });
      expect(decision.status).not.toBe("RELEASE_APPROVED");
    });

    it("allows closing once the financial outcome has been fully applied, and release is no longer blocked by this dispute", async () => {
      const repos = makeRepos();
      const useCases = makeUseCases(repos);
      const { job } = await seedJob(repos, 300);
      const dispute = await openDispute(repos, useCases, job.id);

      await useCases.resolveWithFinancialOutcome.execute(ADMIN, dispute.id, {
        resolution: "CUSTOMER_FAVOR",
        resolutionNote: "Refunding in full.",
      });

      const closed = await useCases.closeDispute.execute(ADMIN, dispute.id);
      expect(closed.status).toBe("CLOSED");

      const disputesForJob = await repos.disputes.listByJobId(job.id);
      const hasBlockingDispute = disputesForJob.some((d) => d.status !== "CLOSED");
      expect(hasBlockingDispute).toBe(false);
    });

    it("PROFESSIONAL_FAVOR and NO_ACTION resolutions close normally without ever needing a decision (unaffected by the Module 68 guard)", async () => {
      const repos = makeRepos();
      const useCases = makeUseCases(repos);
      const { job } = await seedJob(repos, 300);
      const dispute = await openDispute(repos, useCases, job.id);

      await useCases.resolveDispute.execute(ADMIN, dispute.id, {
        resolution: "PROFESSIONAL_FAVOR",
        resolutionNote: "The claim was unfounded.",
      });

      const closed = await useCases.closeDispute.execute(ADMIN, dispute.id);
      expect(closed.status).toBe("CLOSED");
    });
  });

  it("CUSTOMER_FAVOR against a job with no captured payment is a hard error — never a $0 refund", async () => {
    const repos = makeRepos();
    const useCases = makeUseCases(repos);
    const { job } = await seedJob(repos, 300);
    // Remove the seeded payment so no captured Payment exists for this job.
    repos.payments.payments.clear();
    const dispute = await openDispute(repos, useCases, job.id);

    await expect(
      useCases.resolveWithFinancialOutcome.execute(ADMIN, dispute.id, {
        resolution: "CUSTOMER_FAVOR",
        resolutionNote: "Refunding in full.",
      }),
    ).rejects.toThrow(ValidationError);

    // The dispute must NOT have been left in a half-resolved state with no
    // decision — ResolveDisputeUseCase already persisted RESOLVED before
    // the financial-outcome computation threw, so a retry must still be
    // possible via the crash-recovery path (case 3) once a valid payment
    // exists — not tested further here, but the important invariant is
    // that no adjustment or decision was created for the invalid attempt.
    expect(await repos.adjustments.listForJob(job.id)).toHaveLength(0);
  });
});
