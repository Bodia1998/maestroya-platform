import { describe, expect, it } from "vitest";

import {
  DetectJobCompletionDisputeConflictUseCase,
  JobCompletionDisputeConflictOnDisputeCreatedSubscriber,
  JobCompletionDisputeConflictOnProfessionalCompletedJobSubscriber,
} from "@/application/use-cases/trust-integrity/detect-job-completion-dispute-conflict.use-case";
import { RecordUserBehaviorSignalUseCase } from "@/application/use-cases/trust-integrity/record-user-behavior-signal.use-case";
import { ProfessionalCompletedJob } from "@/domain/events/professional-completed-job";
import { DisputeCreated } from "@/domain/events/dispute-created";
import type { DomainEvent, DomainEventClass } from "@/domain/events/domain-event";
import type { EventBus, EventHandler } from "@/application/ports/event-bus";
import type { JobRecord, JobRepository, CancelJobData, CompleteJobData, ListJobsOptions, StartJobData, JobSummary } from "@/domain/repositories/job-repository";
import type {
  CreateDisputeData,
  DisputeRecord,
  DisputeRepository,
  ListAdminDisputesOptions,
  ListDisputesOptions,
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
import { DEFAULT_TRUST_SCORE } from "@/domain/services/trust-score-policy";
import { DEFAULT_RISK_SCORE } from "@/domain/services/risk-score-policy";

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
  async listForCustomer(_customerId: string, _options: ListJobsOptions): Promise<JobSummary[]> {
    return [];
  }
  async listForProfessional(_professionalProfileId: string, _options: ListJobsOptions): Promise<JobSummary[]> {
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
  async listRaisedByUser(_userId: string, _options: ListDisputesOptions): Promise<DisputeRecord[]> {
    return [];
  }
  async listForAdmin(_options: ListAdminDisputesOptions): Promise<DisputeRecord[]> {
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
      trustScore: DEFAULT_TRUST_SCORE,
      riskScore: DEFAULT_RISK_SCORE,
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
  async countByRiskScoreAtLeast(minRiskScore: number): Promise<number> {
    return [...this.profiles.values()].filter((p) => p.riskScore >= minRiskScore).length;
  }
  async countByTrustScoreAtMost(maxTrustScore: number): Promise<number> {
    return [...this.profiles.values()].filter((p) => p.trustScore <= maxTrustScore).length;
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

function buildJob(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: "job-1",
    serviceRequestId: "sr-1",
    quoteId: "quote-1",
    customerId: "customer-1",
    professionalProfileId: PROFESSIONAL.id,
    companyProfileId: null,
    status: "COMPLETED",
    startedAt: new Date("2026-08-15T10:00:00.000Z"),
    startedByUserId: PROFESSIONAL.userId,
    completedAt: new Date("2026-08-15T12:00:00.000Z"),
    completedByUserId: PROFESSIONAL.userId,
    cancelledAt: null,
    cancelledByUserId: null,
    cancellationReason: null,
    cancellationNote: null,
    createdAt: new Date("2026-08-15T09:00:00.000Z"),
    updatedAt: new Date("2026-08-15T12:00:00.000Z"),
    ...overrides,
  };
}

function buildDispute(overrides: Partial<DisputeRecord> = {}): DisputeRecord {
  return {
    id: "dispute-1",
    caseNumber: "DSP-2026-000001",
    title: "Service not completed",
    jobId: "job-1",
    serviceRequestId: "sr-1",
    raisedByUserId: "customer-1",
    respondentProfessionalProfileId: PROFESSIONAL.id,
    respondentCompanyProfileId: null,
    reason: "SERVICE_NOT_COMPLETED",
    status: "OPEN",
    priority: "MEDIUM",
    description: "The work was not finished.",
    assignedAdminUserId: null,
    resolution: null,
    resolutionNote: null,
    resolvedAt: null,
    resolvedByUserId: null,
    closedAt: null,
    closedByUserId: null,
    createdAt: new Date("2026-08-15T12:05:00.000Z"),
    updatedAt: new Date("2026-08-15T12:05:00.000Z"),
    ...overrides,
  };
}

function buildHarness(jobs: JobRecord[] = [], disputes: DisputeRecord[] = []) {
  const jobRepo = new FakeJobRepository(jobs);
  const disputeRepo = new FakeDisputeRepository(disputes);
  const professionals = new FakeProfessionalRepository([PROFESSIONAL]);
  const fraudSignals = new FakeFraudSignalRepository();
  const manualReviewCases = new FakeManualReviewCaseRepository();
  const trustProfiles = new FakeTrustProfileRepository();
  const eventBus = new RecordingEventBus();
  const recordBehaviorSignal = new RecordUserBehaviorSignalUseCase(trustProfiles, eventBus);
  const detector = new DetectJobCompletionDisputeConflictUseCase(
    jobRepo,
    disputeRepo,
    professionals,
    fraudSignals,
    manualReviewCases,
    recordBehaviorSignal,
    eventBus,
  );
  return { detector, jobRepo, disputeRepo, fraudSignals, manualReviewCases, trustProfiles, eventBus };
}

describe("Module 67 — DetectJobCompletionDisputeConflictUseCase.onDisputeCreated (scenarios 1/3)", () => {
  it("does nothing when the job has not been completed yet", async () => {
    const job = buildJob({ status: "IN_PROGRESS", completedAt: null });
    const { detector, manualReviewCases } = buildHarness([job]);

    await detector.onDisputeCreated(
      new DisputeCreated("dispute-1", "DSP-2026-000001", "job-1", "SERVICE_NOT_COMPLETED", "customer-1", []),
    );

    expect(manualReviewCases.cases).toHaveLength(0);
  });

  it("opens a ManualReviewCase (no automatic score movement) for a dispute opened immediately after completion", async () => {
    const job = buildJob();
    const { detector, manualReviewCases, trustProfiles } = buildHarness([job]);

    const disputeCreatedAt = new Date(job.completedAt!.getTime() + 60_000); // 1 minute later
    const event = new DisputeCreated("dispute-1", "DSP-2026-000001", "job-1", "SERVICE_NOT_COMPLETED", "customer-1", []);
    // occurredAt on DomainEvent defaults to "now" at construction; override
    // for deterministic timing in this test.
    Object.assign(event, { occurredAt: disputeCreatedAt });

    await detector.onDisputeCreated(event);

    expect(manualReviewCases.cases).toHaveLength(1);
    expect(manualReviewCases.cases[0]!.reason).toBe("JOB_COMPLETION_DISPUTE_CONFLICT_DETECTED");
    expect(manualReviewCases.cases[0]!.userId).toBe("customer-1");
    expect(manualReviewCases.cases[0]!.summary).toContain("job-1");
    expect(manualReviewCases.cases[0]!.summary).toContain("dispute-1");

    // Ambiguous fault — no Trust/Risk Score movement for this scenario.
    expect(await trustProfiles.findByUserId("customer-1")).toBeNull();
  });

  it("does not open a review case for a dispute opened well after completion", async () => {
    const job = buildJob();
    const { detector, manualReviewCases } = buildHarness([job]);

    const disputeCreatedAt = new Date(job.completedAt!.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days later
    const event = new DisputeCreated("dispute-1", "DSP-2026-000001", "job-1", "SERVICE_NOT_COMPLETED", "customer-1", []);
    Object.assign(event, { occurredAt: disputeCreatedAt });

    await detector.onDisputeCreated(event);

    expect(manualReviewCases.cases).toHaveLength(0);
  });

  it("is idempotent — the same DisputeCreated event handled twice opens only one ManualReviewCase", async () => {
    const job = buildJob();
    const { detector, manualReviewCases } = buildHarness([job]);

    const disputeCreatedAt = new Date(job.completedAt!.getTime() + 60_000);
    const event = new DisputeCreated("dispute-1", "DSP-2026-000001", "job-1", "SERVICE_NOT_COMPLETED", "customer-1", []);
    Object.assign(event, { occurredAt: disputeCreatedAt });

    await detector.onDisputeCreated(event);
    await detector.onDisputeCreated(event);

    expect(manualReviewCases.cases).toHaveLength(1);
  });

  it("the EventHandler adapter routes DisputeCreated into the detector", async () => {
    const job = buildJob();
    const { detector, manualReviewCases } = buildHarness([job]);
    const subscriber = new JobCompletionDisputeConflictOnDisputeCreatedSubscriber(detector);

    const disputeCreatedAt = new Date(job.completedAt!.getTime() + 60_000);
    const event = new DisputeCreated("dispute-1", "DSP-2026-000001", "job-1", "SERVICE_NOT_COMPLETED", "customer-1", []);
    Object.assign(event, { occurredAt: disputeCreatedAt });

    await subscriber.handle(event);

    expect(manualReviewCases.cases).toHaveLength(1);
  });
});

describe("Module 67 — DetectJobCompletionDisputeConflictUseCase.onProfessionalCompletedJob (scenarios 2/5)", () => {
  it("does nothing when no dispute is open on the job at completion time", async () => {
    const { detector, fraudSignals } = buildHarness([], []);

    await detector.onProfessionalCompletedJob(
      new ProfessionalCompletedJob(
        "job-1",
        PROFESSIONAL.id,
        null,
        PROFESSIONAL.userId,
        new Date("2026-08-15T10:00:00.000Z"),
        new Date("2026-08-15T12:00:00.000Z"),
        new Date("2026-08-18T12:00:00.000Z"),
      ),
    );

    expect(fraudSignals.signals).toHaveLength(0);
  });

  it("records a FraudSignal + score movement attributed to the professional when completing while a dispute is open", async () => {
    const openDispute = buildDispute({ status: "OPEN" });
    const { detector, fraudSignals, trustProfiles, eventBus } = buildHarness([], [openDispute]);

    await detector.onProfessionalCompletedJob(
      new ProfessionalCompletedJob(
        "job-1",
        PROFESSIONAL.id,
        null,
        PROFESSIONAL.userId,
        new Date("2026-08-15T10:00:00.000Z"),
        new Date("2026-08-15T12:00:00.000Z"),
        new Date("2026-08-18T12:00:00.000Z"),
      ),
    );

    expect(fraudSignals.signals).toHaveLength(1);
    expect(fraudSignals.signals[0]!.type).toBe("COMPLETION_DURING_ACTIVE_DISPUTE");
    expect(fraudSignals.signals[0]!.userId).toBe(PROFESSIONAL.userId);

    const profile = await trustProfiles.findByUserId(PROFESSIONAL.userId);
    expect(profile!.riskScore).toBeGreaterThan(DEFAULT_RISK_SCORE);
    expect(eventBus.published.some((e) => e.eventName === "trust_integrity.fraud.detected")).toBe(true);
  });

  it("ignores a CLOSED dispute — only non-CLOSED disputes count as 'active'", async () => {
    const closedDispute = buildDispute({ status: "CLOSED" });
    const { detector, fraudSignals } = buildHarness([], [closedDispute]);

    await detector.onProfessionalCompletedJob(
      new ProfessionalCompletedJob(
        "job-1",
        PROFESSIONAL.id,
        null,
        PROFESSIONAL.userId,
        new Date("2026-08-15T10:00:00.000Z"),
        new Date("2026-08-15T12:00:00.000Z"),
        new Date("2026-08-18T12:00:00.000Z"),
      ),
    );

    expect(fraudSignals.signals).toHaveLength(0);
  });

  it("does nothing for a company-owned job (no professionalProfileId)", async () => {
    const openDispute = buildDispute({ status: "OPEN" });
    const { detector, fraudSignals } = buildHarness([], [openDispute]);

    await detector.onProfessionalCompletedJob(
      new ProfessionalCompletedJob(
        "job-1",
        null,
        "company-1",
        "user-company-owner",
        new Date("2026-08-15T10:00:00.000Z"),
        new Date("2026-08-15T12:00:00.000Z"),
        new Date("2026-08-18T12:00:00.000Z"),
      ),
    );

    expect(fraudSignals.signals).toHaveLength(0);
  });

  it("is idempotent — the same ProfessionalCompletedJob event handled twice creates only one FraudSignal", async () => {
    const openDispute = buildDispute({ status: "OPEN" });
    const { detector, fraudSignals } = buildHarness([], [openDispute]);
    const event = new ProfessionalCompletedJob(
      "job-1",
      PROFESSIONAL.id,
      null,
      PROFESSIONAL.userId,
      new Date("2026-08-15T10:00:00.000Z"),
      new Date("2026-08-15T12:00:00.000Z"),
      new Date("2026-08-18T12:00:00.000Z"),
    );

    await detector.onProfessionalCompletedJob(event);
    await detector.onProfessionalCompletedJob(event);

    expect(fraudSignals.signals).toHaveLength(1);
  });

  it("the EventHandler adapter routes ProfessionalCompletedJob into the detector", async () => {
    const openDispute = buildDispute({ status: "OPEN" });
    const { detector, fraudSignals } = buildHarness([], [openDispute]);
    const subscriber = new JobCompletionDisputeConflictOnProfessionalCompletedJobSubscriber(detector);

    await subscriber.handle(
      new ProfessionalCompletedJob(
        "job-1",
        PROFESSIONAL.id,
        null,
        PROFESSIONAL.userId,
        new Date("2026-08-15T10:00:00.000Z"),
        new Date("2026-08-15T12:00:00.000Z"),
        new Date("2026-08-18T12:00:00.000Z"),
      ),
    );

    expect(fraudSignals.signals).toHaveLength(1);
  });
});
