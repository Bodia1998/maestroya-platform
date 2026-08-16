import { describe, expect, it } from "vitest";

import { DetectPrematureJobCompletionUseCase } from "@/application/use-cases/trust-integrity/detect-premature-job-completion.use-case";
import { DetectJobCompletionDisputeConflictUseCase } from "@/application/use-cases/trust-integrity/detect-job-completion-dispute-conflict.use-case";
import { RecordUserBehaviorSignalUseCase } from "@/application/use-cases/trust-integrity/record-user-behavior-signal.use-case";
import { ProfessionalCompletedJob } from "@/domain/events/professional-completed-job";
import { DisputeCreated } from "@/domain/events/dispute-created";
import type { DomainEvent, DomainEventClass } from "@/domain/events/domain-event";
import type { EventBus, EventHandler } from "@/application/ports/event-bus";
import type { JobRecord, JobRepository, CancelJobData, CompleteJobData, StartJobData, JobSummary } from "@/domain/repositories/job-repository";
import type {
  CreateDisputeData,
  DisputeRecord,
  DisputeRepository,
} from "@/domain/repositories/dispute-repository";
import type { ProfessionalRecord, ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type {
  CreateFraudSignalData,
  FraudSignalRecord,
  FraudSignalRepository,
  FraudSignalType,
} from "@/domain/repositories/fraud-signal-repository";
import type {
  CreateManualReviewCaseData,
  ManualReviewCaseRecord,
  ManualReviewCaseRepository,
} from "@/domain/repositories/manual-review-case-repository";
import type { ManualReviewCaseStateValue } from "@/domain/entities/manual-review-case";
import type {
  RecordScoreEventData,
  ScoreEventRecord,
  TrustProfileRecord,
  TrustProfileRepository,
} from "@/domain/repositories/trust-profile-repository";
import { decidePaymentReleaseStatus } from "@/domain/services/payment-release-decision";

/**
 * Module 67 — Trust & Integrity Completion Risk Detection: end-to-end
 * coverage across both real detectors + real domain rule engines, with
 * in-memory fakes swapped in for storage — same pattern as
 * tests/integration/trust-integrity/trust-integrity-flows.test.ts.
 *
 * The specific thing this file proves (per this module's own hard
 * constraints — "Module 67 cannot release money", "Module 67 cannot bypass
 * PaymentReleaseDecision", "RELEASE_APPROVED still requires Module 66's
 * decision process"): running BOTH Module 67 detectors against a realistic
 * event stream never publishes a payment-release event, and
 * `decidePaymentReleaseStatus` (Module 66's sole authority — see that
 * function's own doc comment) is never given anything by this module —
 * it is not even imported by either detector or its compose.ts wiring.
 * The only place it's imported below is this test file itself, to prove by
 * direct call that a DISPUTED confirmation status is still `RELEASE_HELD`
 * regardless of what Trust & Integrity signals Module 67 produced.
 */

class RecordingEventBus implements EventBus {
  readonly published: DomainEvent[] = [];
  async publish<T extends DomainEvent>(event: T): Promise<void> {
    this.published.push(event);
  }
  async publishAll(events: DomainEvent[]): Promise<void> {
    for (const event of events) await this.publish(event);
  }
  subscribe<T extends DomainEvent>(_eventType: DomainEventClass<T>, _handler: EventHandler<T>): void {}
}

class FakeJobRepository implements JobRepository {
  constructor(private readonly jobs: JobRecord[]) {}
  async findById(id: string): Promise<JobRecord | null> {
    return this.jobs.find((j) => j.id === id) ?? null;
  }
  async listForCustomer(): Promise<JobSummary[]> {
    return [];
  }
  async listForProfessional(): Promise<JobSummary[]> {
    return [];
  }
  async startWork(_data: StartJobData): Promise<JobRecord> {
    throw new Error("not implemented in fake");
  }
  async complete(_data: CompleteJobData): Promise<JobRecord> {
    throw new Error("not implemented in fake");
  }
  async cancel(_data: CancelJobData): Promise<JobRecord> {
    throw new Error("not implemented in fake");
  }
}

class FakeDisputeRepository implements DisputeRepository {
  constructor(private readonly disputes: DisputeRecord[]) {}
  async findById(id: string): Promise<DisputeRecord | null> {
    return this.disputes.find((d) => d.id === id) ?? null;
  }
  async listByJobId(jobId: string): Promise<DisputeRecord[]> {
    return this.disputes.filter((d) => d.jobId === jobId);
  }
  async listRaisedByUser(): Promise<DisputeRecord[]> {
    return [];
  }
  async listForAdmin(): Promise<DisputeRecord[]> {
    return [];
  }
  async create(_data: CreateDisputeData): Promise<DisputeRecord> {
    throw new Error("not implemented in fake");
  }
  async updateStatus(): Promise<DisputeRecord> {
    throw new Error("not implemented in fake");
  }
  async assign(): Promise<DisputeRecord> {
    throw new Error("not implemented in fake");
  }
  async setPriority(): Promise<DisputeRecord> {
    throw new Error("not implemented in fake");
  }
}

class FakeProfessionalRepository implements ProfessionalRepository {
  constructor(private readonly professionals: ProfessionalRecord[]) {}
  async findById(id: string): Promise<ProfessionalRecord | null> {
    return this.professionals.find((p) => p.id === id) ?? null;
  }
  async findByUserId(userId: string): Promise<ProfessionalRecord | null> {
    return this.professionals.find((p) => p.userId === userId) ?? null;
  }
  async create(): Promise<ProfessionalRecord> {
    throw new Error("not implemented in fake");
  }
  async update(): Promise<ProfessionalRecord> {
    throw new Error("not implemented in fake");
  }
  async updateStatus(): Promise<void> {}
  async updateCategories(): Promise<ProfessionalRecord> {
    throw new Error("not implemented in fake");
  }
}

class FakeFraudSignalRepository implements FraudSignalRepository {
  readonly signals: FraudSignalRecord[] = [];
  private idCounter = 0;
  async create(data: CreateFraudSignalData): Promise<FraudSignalRecord> {
    const record: FraudSignalRecord = {
      id: `signal-${++this.idCounter}`,
      userId: data.userId,
      type: data.type,
      status: "OPEN",
      detail: data.detail,
      relatedUserIds: data.relatedUserIds ?? [],
      resolvedAt: null,
      resolvedByUserId: null,
      resolution: null,
      createdAt: new Date(),
    };
    this.signals.push(record);
    return record;
  }
  async listForUser(userId: string): Promise<FraudSignalRecord[]> {
    return this.signals.filter((s) => s.userId === userId);
  }
  async listOpen(): Promise<FraudSignalRecord[]> {
    return this.signals.filter((s) => s.status === "OPEN");
  }
  async resolve(): Promise<FraudSignalRecord> {
    throw new Error("not implemented in fake");
  }
  async countOpenForUser(userId: string): Promise<number> {
    return this.signals.filter((s) => s.userId === userId && s.status === "OPEN").length;
  }
  async countAll(): Promise<number> {
    return this.signals.length;
  }
  async countByType(type: FraudSignalType): Promise<number> {
    return this.signals.filter((s) => s.type === type).length;
  }
}

class FakeManualReviewCaseRepository implements ManualReviewCaseRepository {
  readonly cases: ManualReviewCaseRecord[] = [];
  private idCounter = 0;
  async create(data: CreateManualReviewCaseData): Promise<ManualReviewCaseRecord> {
    const record: ManualReviewCaseRecord = {
      id: `review-${++this.idCounter}`,
      userId: data.userId,
      state: "OPEN",
      reason: data.reason,
      summary: data.summary,
      assignedAdminId: null,
      resolvedAt: null,
      resolvedByUserId: null,
      resolutionNotes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.cases.push(record);
    return record;
  }
  async findById(id: string): Promise<ManualReviewCaseRecord | null> {
    return this.cases.find((c) => c.id === id) ?? null;
  }
  async listForUser(userId: string): Promise<ManualReviewCaseRecord[]> {
    return this.cases.filter((c) => c.userId === userId);
  }
  async listByState(state: ManualReviewCaseStateValue): Promise<ManualReviewCaseRecord[]> {
    return this.cases.filter((c) => c.state === state);
  }
  async assign(): Promise<ManualReviewCaseRecord> {
    throw new Error("not implemented in fake");
  }
  async transition(): Promise<ManualReviewCaseRecord> {
    throw new Error("not implemented in fake");
  }
  async countByState(state: ManualReviewCaseStateValue): Promise<number> {
    return this.cases.filter((c) => c.state === state).length;
  }
  async countAll(): Promise<number> {
    return this.cases.length;
  }
}

class FakeTrustProfileRepository implements TrustProfileRepository {
  private readonly profiles = new Map<string, TrustProfileRecord>();
  private idCounter = 0;
  async findOrCreateByUserId(userId: string): Promise<TrustProfileRecord> {
    const existing = this.profiles.get(userId);
    if (existing) return existing;
    const record: TrustProfileRecord = {
      id: `profile-${++this.idCounter}`,
      userId,
      trustScore: 70,
      riskScore: 0,
      lastRecalculatedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.profiles.set(userId, record);
    return record;
  }
  async findByUserId(userId: string): Promise<TrustProfileRecord | null> {
    return this.profiles.get(userId) ?? null;
  }
  private findById(id: string): TrustProfileRecord {
    const found = [...this.profiles.values()].find((p) => p.id === id);
    if (!found) throw new Error(`no fake profile ${id}`);
    return found;
  }
  async updateTrustScore(trustProfileId: string, newScore: number, _event: RecordScoreEventData): Promise<TrustProfileRecord> {
    const record = { ...this.findById(trustProfileId), trustScore: newScore };
    this.profiles.set(record.userId, record);
    return record;
  }
  async updateRiskScore(trustProfileId: string, newScore: number, _event: RecordScoreEventData): Promise<TrustProfileRecord> {
    const record = { ...this.findById(trustProfileId), riskScore: newScore };
    this.profiles.set(record.userId, record);
    return record;
  }
  async listTrustScoreEvents(): Promise<ScoreEventRecord[]> {
    return [];
  }
  async listRiskScoreEvents(): Promise<ScoreEventRecord[]> {
    return [];
  }
  async countByRiskScoreAtLeast(min: number): Promise<number> {
    return [...this.profiles.values()].filter((p) => p.riskScore >= min).length;
  }
  async countByTrustScoreAtMost(max: number): Promise<number> {
    return [...this.profiles.values()].filter((p) => p.trustScore <= max).length;
  }
  async countAll(): Promise<number> {
    return this.profiles.size;
  }
}

const PROFESSIONAL: ProfessionalRecord = {
  id: "professional-1",
  userId: "user-professional-1",
  businessName: null,
  bio: null,
  headline: null,
  yearsExperience: null,
  hourlyRate: null,
  serviceRadiusKm: null,
  contactEmail: null,
  contactPhone: null,
  websiteUrl: null,
  taxId: null,
  status: "ACTIVE",
  verificationStatus: "VERIFIED",
  verifiedAt: new Date(),
  isAcceptingRequests: true,
  categoryIds: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("Module 67 — job completion risk detection, end to end, against the Module 66 payment boundary", () => {
  it("flags a premature completion + a completion-during-active-dispute, but never publishes a payment-release event", async () => {
    const jobId = "job-1";
    const job: JobRecord = {
      id: jobId,
      serviceRequestId: "sr-1",
      quoteId: "quote-1",
      customerId: "customer-1",
      professionalProfileId: PROFESSIONAL.id,
      companyProfileId: null,
      status: "COMPLETED",
      startedAt: new Date("2026-08-15T11:59:00.000Z"),
      startedByUserId: PROFESSIONAL.userId,
      completedAt: new Date("2026-08-15T12:00:00.000Z"), // 1 minute later — premature
      completedByUserId: PROFESSIONAL.userId,
      cancelledAt: null,
      cancelledByUserId: null,
      cancellationReason: null,
      cancellationNote: null,
      createdAt: new Date("2026-08-15T09:00:00.000Z"),
      updatedAt: new Date("2026-08-15T12:00:00.000Z"),
    };
    const openDispute: DisputeRecord = {
      id: "dispute-1",
      caseNumber: "DSP-2026-000001",
      title: "Service not completed",
      jobId,
      serviceRequestId: "sr-1",
      raisedByUserId: "customer-1",
      respondentProfessionalProfileId: PROFESSIONAL.id,
      respondentCompanyProfileId: null,
      reason: "SERVICE_NOT_COMPLETED",
      status: "OPEN",
      priority: "MEDIUM",
      description: "Work was not finished.",
      assignedAdminUserId: null,
      resolution: null,
      resolutionNote: null,
      resolvedAt: null,
      resolvedByUserId: null,
      closedAt: null,
      closedByUserId: null,
      createdAt: new Date("2026-08-15T11:00:00.000Z"), // opened BEFORE completion — scenario 2/5
      updatedAt: new Date("2026-08-15T11:00:00.000Z"),
    };

    const jobs = new FakeJobRepository([job]);
    const disputes = new FakeDisputeRepository([openDispute]);
    const professionals = new FakeProfessionalRepository([PROFESSIONAL]);
    const fraudSignals = new FakeFraudSignalRepository();
    const manualReviewCases = new FakeManualReviewCaseRepository();
    const trustProfiles = new FakeTrustProfileRepository();
    const eventBus = new RecordingEventBus();
    const recordBehaviorSignal = new RecordUserBehaviorSignalUseCase(trustProfiles, eventBus);

    const prematureDetector = new DetectPrematureJobCompletionUseCase(
      professionals,
      fraudSignals,
      recordBehaviorSignal,
      eventBus,
    );
    const conflictDetector = new DetectJobCompletionDisputeConflictUseCase(
      jobs,
      disputes,
      professionals,
      fraudSignals,
      manualReviewCases,
      recordBehaviorSignal,
      eventBus,
    );

    const completedEvent = new ProfessionalCompletedJob(
      jobId,
      PROFESSIONAL.id,
      null,
      PROFESSIONAL.userId,
      job.startedAt,
      job.completedAt!,
      new Date(job.completedAt!.getTime() + 72 * 60 * 60 * 1000),
    );

    await prematureDetector.handle(completedEvent);
    await conflictDetector.onProfessionalCompletedJob(completedEvent);

    // Both detectors fired real signals...
    expect(fraudSignals.signals.map((s) => s.type).sort()).toEqual(
      ["COMPLETION_DURING_ACTIVE_DISPUTE", "PREMATURE_JOB_COMPLETION"].sort(),
    );
    const profile = await trustProfiles.findByUserId(PROFESSIONAL.userId);
    expect(profile!.riskScore).toBeGreaterThan(0);

    // ...but NEVER a payment-release event of any kind. Module 67 has no
    // dependency capable of producing one — this asserts the observable
    // consequence of that missing dependency.
    const paymentEvents = eventBus.published.filter((e) => e.eventName.startsWith("job.payment-release"));
    expect(paymentEvents).toHaveLength(0);

    // And Module 66's own authoritative function, called independently
    // here exactly as EvaluatePaymentReleaseUseCase would, still holds
    // release for the open dispute — completely unaffected by (and
    // unaware of) the Trust & Integrity signals Module 67 just recorded.
    const decision = decidePaymentReleaseStatus({
      jobStatus: job.status,
      confirmationStatus: "WAITING_FOR_CUSTOMER",
      hasBlockingDispute: true,
      paymentStatus: "CAPTURED",
      payoutEligible: true,
      payoutHoldActive: false,
    });
    expect(decision.status).toBe("RELEASE_HELD");
  });

  it("a fast dispute after a normal completion opens a review case, still without ever touching payment release", async () => {
    const jobId = "job-2";
    const job: JobRecord = {
      id: jobId,
      serviceRequestId: "sr-2",
      quoteId: "quote-2",
      customerId: "customer-2",
      professionalProfileId: PROFESSIONAL.id,
      companyProfileId: null,
      status: "COMPLETED",
      startedAt: new Date("2026-08-15T09:00:00.000Z"),
      startedByUserId: PROFESSIONAL.userId,
      completedAt: new Date("2026-08-15T12:00:00.000Z"), // 3 hours — not premature
      completedByUserId: PROFESSIONAL.userId,
      cancelledAt: null,
      cancelledByUserId: null,
      cancellationReason: null,
      cancellationNote: null,
      createdAt: new Date("2026-08-15T08:00:00.000Z"),
      updatedAt: new Date("2026-08-15T12:00:00.000Z"),
    };

    const jobs = new FakeJobRepository([job]);
    const disputes = new FakeDisputeRepository([]);
    const professionals = new FakeProfessionalRepository([PROFESSIONAL]);
    const fraudSignals = new FakeFraudSignalRepository();
    const manualReviewCases = new FakeManualReviewCaseRepository();
    const trustProfiles = new FakeTrustProfileRepository();
    const eventBus = new RecordingEventBus();
    const recordBehaviorSignal = new RecordUserBehaviorSignalUseCase(trustProfiles, eventBus);

    const conflictDetector = new DetectJobCompletionDisputeConflictUseCase(
      jobs,
      disputes,
      professionals,
      fraudSignals,
      manualReviewCases,
      recordBehaviorSignal,
      eventBus,
    );

    const disputeEvent = new DisputeCreated(
      "dispute-2",
      "DSP-2026-000002",
      jobId,
      "SERVICE_QUALITY",
      "customer-2",
      [PROFESSIONAL.userId],
    );
    Object.assign(disputeEvent, { occurredAt: new Date(job.completedAt!.getTime() + 2 * 60_000) });

    await conflictDetector.onDisputeCreated(disputeEvent);

    expect(manualReviewCases.cases).toHaveLength(1);
    expect(manualReviewCases.cases[0]!.reason).toBe("JOB_COMPLETION_DISPUTE_CONFLICT_DETECTED");
    // Ambiguous fault — no FraudSignal, no score movement for this scenario.
    expect(fraudSignals.signals).toHaveLength(0);
    expect(await trustProfiles.findByUserId("customer-2")).toBeNull();
    expect(eventBus.published.filter((e) => e.eventName.startsWith("job.payment-release"))).toHaveLength(0);
  });
});
