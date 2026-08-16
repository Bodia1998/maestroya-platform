import { describe, expect, it } from "vitest";

import { DetectPrematureJobCompletionUseCase } from "@/application/use-cases/trust-integrity/detect-premature-job-completion.use-case";
import { RecordUserBehaviorSignalUseCase } from "@/application/use-cases/trust-integrity/record-user-behavior-signal.use-case";
import { ProfessionalCompletedJob } from "@/domain/events/professional-completed-job";
import type { DomainEvent, DomainEventClass } from "@/domain/events/domain-event";
import type { EventBus, EventHandler } from "@/application/ports/event-bus";
import type {
  CreateFraudSignalData,
  FraudSignalRecord,
  FraudSignalRepository,
  FraudSignalType,
} from "@/domain/repositories/fraud-signal-repository";
import type { ProfessionalRecord, ProfessionalRepository } from "@/domain/repositories/professional-repository";
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

function buildUseCase() {
  const professionals = new FakeProfessionalRepository([PROFESSIONAL]);
  const fraudSignals = new FakeFraudSignalRepository();
  const trustProfiles = new FakeTrustProfileRepository();
  const eventBus = new RecordingEventBus();
  const recordBehaviorSignal = new RecordUserBehaviorSignalUseCase(trustProfiles, eventBus);
  const useCase = new DetectPrematureJobCompletionUseCase(professionals, fraudSignals, recordBehaviorSignal, eventBus);
  return { useCase, professionals, fraudSignals, trustProfiles, eventBus };
}

function completedEvent(overrides: Partial<{ startedAt: Date | null; completedAt: Date; professionalProfileId: string | null }> = {}) {
  const completedAt = overrides.completedAt ?? new Date("2026-08-15T12:00:00.000Z");
  const startedAt = "startedAt" in overrides ? overrides.startedAt! : new Date(completedAt.getTime() - 60_000);
  return new ProfessionalCompletedJob(
    "job-1",
    overrides.professionalProfileId === undefined ? PROFESSIONAL.id : overrides.professionalProfileId,
    null,
    "user-professional-1",
    startedAt,
    completedAt,
    new Date(completedAt.getTime() + 72 * 60 * 60 * 1000),
  );
}

describe("Module 67 — DetectPrematureJobCompletionUseCase", () => {
  it("does nothing for a normal-duration completion", async () => {
    const { useCase, fraudSignals, trustProfiles } = buildUseCase();

    await useCase.handle(completedEvent({ startedAt: new Date("2026-08-15T10:00:00.000Z") }));

    expect(fraudSignals.signals).toHaveLength(0);
    expect(await trustProfiles.findByUserId(PROFESSIONAL.userId)).toBeNull();
  });

  it("records a FraudSignal + Trust/Risk Score movement + FraudDetected for a premature completion", async () => {
    const { useCase, fraudSignals, trustProfiles, eventBus } = buildUseCase();

    await useCase.handle(completedEvent({ startedAt: new Date("2026-08-15T11:59:00.000Z") }));

    expect(fraudSignals.signals).toHaveLength(1);
    expect(fraudSignals.signals[0]!.type).toBe("PREMATURE_JOB_COMPLETION");
    expect(fraudSignals.signals[0]!.userId).toBe(PROFESSIONAL.userId);

    const profile = await trustProfiles.findByUserId(PROFESSIONAL.userId);
    expect(profile!.trustScore).toBeLessThan(DEFAULT_TRUST_SCORE);
    expect(profile!.riskScore).toBeGreaterThan(DEFAULT_RISK_SCORE);

    expect(eventBus.published.some((e) => e.eventName === "trust_integrity.fraud.detected")).toBe(true);
  });

  it("never touches PaymentReleaseStatus/JobCompletionConfirmation — only publishes Trust & Integrity events", async () => {
    const { useCase, eventBus } = buildUseCase();

    await useCase.handle(completedEvent({ startedAt: new Date("2026-08-15T11:59:00.000Z") }));

    const paymentEvents = eventBus.published.filter((e) => e.eventName.startsWith("job.payment-release"));
    expect(paymentEvents).toHaveLength(0);
  });

  it("does nothing when startedAt is missing (safe behavior)", async () => {
    const { useCase, fraudSignals } = buildUseCase();

    await useCase.handle(completedEvent({ startedAt: null }));

    expect(fraudSignals.signals).toHaveLength(0);
  });

  it("does nothing for a company-owned job (no professionalProfileId) — documented scope boundary", async () => {
    const { useCase, fraudSignals } = buildUseCase();

    await useCase.handle(completedEvent({ professionalProfileId: null, startedAt: new Date("2026-08-15T11:59:00.000Z") }));

    expect(fraudSignals.signals).toHaveLength(0);
  });

  it("is idempotent — handling the exact same underlying event twice creates only one FraudSignal and one score movement", async () => {
    const { useCase, fraudSignals, trustProfiles } = buildUseCase();
    const event = completedEvent({ startedAt: new Date("2026-08-15T11:59:00.000Z") });

    await useCase.handle(event);
    await useCase.handle(event);

    expect(fraudSignals.signals).toHaveLength(1);
    const profile = await trustProfiles.findByUserId(PROFESSIONAL.userId);
    // One PREMATURE_JOB_COMPLETION_DETECTED delta only — not doubled.
    expect(profile?.riskScore).toBe(12);
  });

  it("is idempotent across two distinct handler instances sharing the same repositories (simulated redelivery)", async () => {
    const professionals = new FakeProfessionalRepository([PROFESSIONAL]);
    const fraudSignals = new FakeFraudSignalRepository();
    const trustProfiles = new FakeTrustProfileRepository();
    const eventBus = new RecordingEventBus();
    const recordBehaviorSignal = new RecordUserBehaviorSignalUseCase(trustProfiles, eventBus);
    const first = new DetectPrematureJobCompletionUseCase(professionals, fraudSignals, recordBehaviorSignal, eventBus);
    const second = new DetectPrematureJobCompletionUseCase(professionals, fraudSignals, recordBehaviorSignal, eventBus);
    const event = completedEvent({ startedAt: new Date("2026-08-15T11:59:00.000Z") });

    await first.handle(event);
    await second.handle(event);

    expect(fraudSignals.signals).toHaveLength(1);
  });
});
