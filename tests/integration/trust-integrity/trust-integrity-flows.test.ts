import { describe, expect, it, beforeEach } from "vitest";

import type { DomainEvent, DomainEventClass } from "@/domain/events/domain-event";
import type { EventBus, EventHandler } from "@/application/ports/event-bus";
import type {
  TrustProfileRepository,
  TrustProfileRecord,
  ScoreEventRecord,
  RecordScoreEventData,
} from "@/domain/repositories/trust-profile-repository";
import type {
  FraudSignalRepository,
  FraudSignalRecord,
  CreateFraudSignalData,
  FraudSignalType,
} from "@/domain/repositories/fraud-signal-repository";
import type {
  ManualReviewCaseRepository,
  ManualReviewCaseRecord,
  CreateManualReviewCaseData,
} from "@/domain/repositories/manual-review-case-repository";
import type { ManualReviewCaseStateValue } from "@/domain/entities/manual-review-case";
import type {
  TrustAppealRepository,
  TrustAppealRecord,
  CreateTrustAppealData,
} from "@/domain/repositories/trust-appeal-repository";
import type { AppealStateValue } from "@/domain/entities/appeal";
import type {
  TrustAutomatedActionRepository,
  TrustAutomatedActionRecord,
  CreateTrustAutomatedActionData,
  TrustAutomatedActionTypeValue,
} from "@/domain/repositories/trust-automated-action-repository";
import type {
  AccountRestrictionRepository,
  CreateAccountRestrictionData,
  AccountRestrictionRecord,
  ListAccountRestrictionsOptions,
} from "@/domain/repositories/account-restriction-repository";
import { DEFAULT_TRUST_SCORE } from "@/domain/services/trust-score-policy";
import { DEFAULT_RISK_SCORE, RISK_SCORE_THRESHOLDS } from "@/domain/services/risk-score-policy";

import { RecordUserBehaviorSignalUseCase } from "@/application/use-cases/trust-integrity/record-user-behavior-signal.use-case";
import { DetectOffPlatformCommunicationUseCase } from "@/application/use-cases/trust-integrity/detect-off-platform-communication.use-case";
import { DetectFraudSignalsUseCase } from "@/application/use-cases/trust-integrity/detect-fraud-signals.use-case";
import { ApplyAutomatedActionUseCase } from "@/application/use-cases/trust-integrity/apply-automated-action.use-case";
import { OpenManualReviewCaseUseCase } from "@/application/use-cases/trust-integrity/open-manual-review-case.use-case";
import { TransitionManualReviewCaseUseCase } from "@/application/use-cases/trust-integrity/transition-manual-review-case.use-case";
import { SubmitAppealUseCase } from "@/application/use-cases/trust-integrity/submit-appeal.use-case";
import { ReviewAppealUseCase } from "@/application/use-cases/trust-integrity/review-appeal.use-case";
import { RuleBasedOffPlatformDetectionProvider } from "@/infrastructure/trust-integrity/rule-based-off-platform-detection-provider";
import type { OffPlatformDetectionRepository, CreateOffPlatformDetectionEventData, OffPlatformDetectionEventRecord, OffPlatformChannel } from "@/domain/repositories/off-platform-detection-repository";

/**
 * Module 65 — Trust & Integrity System: end-to-end integration coverage
 * across real use cases + real domain rule engines, with in-memory fakes
 * swapped in for storage — same pattern as every other module's own
 * integration tests (see tests/integration/materials/materials-
 * procurement-flow.test.ts).
 */

class RecordingEventBus implements EventBus {
  readonly published: DomainEvent[] = [];

  async publish<T extends DomainEvent>(event: T): Promise<void> {
    this.published.push(event);
  }

  async publishAll(events: DomainEvent[]): Promise<void> {
    for (const event of events) await this.publish(event);
  }

  subscribe<T extends DomainEvent>(_eventType: DomainEventClass<T>, _handler: EventHandler<T>): void {
    // not needed for these tests
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

  async resolve(id: string, data: { status: "REVIEWED" | "DISMISSED" | "CONFIRMED"; resolvedByUserId: string; resolution: string }): Promise<FraudSignalRecord> {
    const signal = this.signals.find((s) => s.id === id);
    if (!signal) throw new Error("not found");
    Object.assign(signal, { status: data.status, resolvedAt: new Date(), resolvedByUserId: data.resolvedByUserId, resolution: data.resolution });
    return signal;
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

class FakeOffPlatformDetectionRepository implements OffPlatformDetectionRepository {
  readonly events: OffPlatformDetectionEventRecord[] = [];
  private idCounter = 0;

  async create(data: CreateOffPlatformDetectionEventData): Promise<OffPlatformDetectionEventRecord> {
    const record: OffPlatformDetectionEventRecord = { id: `evt-${++this.idCounter}`, createdAt: new Date(), ...data };
    this.events.push(record);
    return record;
  }

  async listForUser(userId: string): Promise<OffPlatformDetectionEventRecord[]> {
    return this.events.filter((e) => e.userId === userId);
  }

  async countForUserSince(userId: string): Promise<number> {
    return this.events.filter((e) => e.userId === userId).length;
  }

  async countAll(): Promise<number> {
    return this.events.length;
  }

  async countByChannel(channel: OffPlatformChannel): Promise<number> {
    return this.events.filter((e) => e.channel === channel).length;
  }
}

class FakeTrustAutomatedActionRepository implements TrustAutomatedActionRepository {
  readonly actions: TrustAutomatedActionRecord[] = [];
  private idCounter = 0;

  async create(data: CreateTrustAutomatedActionData): Promise<TrustAutomatedActionRecord> {
    const record: TrustAutomatedActionRecord = {
      id: `action-${++this.idCounter}`,
      userId: data.userId,
      type: data.type,
      status: "ACTIVE",
      reason: data.reason,
      triggeringRiskScore: data.triggeringRiskScore,
      detail: data.detail,
      createdByUserId: data.createdByUserId ?? null,
      expiresAt: data.expiresAt ?? null,
      reversedAt: null,
      reversedByUserId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.actions.push(record);
    return record;
  }

  async findById(id: string): Promise<TrustAutomatedActionRecord | null> {
    return this.actions.find((a) => a.id === id) ?? null;
  }

  async listForUser(userId: string): Promise<TrustAutomatedActionRecord[]> {
    return this.actions.filter((a) => a.userId === userId);
  }

  async listActiveForUser(userId: string, type?: TrustAutomatedActionTypeValue): Promise<TrustAutomatedActionRecord[]> {
    return this.actions.filter((a) => a.userId === userId && a.status === "ACTIVE" && (!type || a.type === type));
  }

  async countActiveForUser(userId: string): Promise<number> {
    return this.actions.filter((a) => a.userId === userId && a.status === "ACTIVE").length;
  }

  async reverse(id: string, reversedByUserId: string): Promise<TrustAutomatedActionRecord> {
    const action = this.actions.find((a) => a.id === id);
    if (!action) throw new Error("not found");
    Object.assign(action, { status: "REVERSED", reversedAt: new Date(), reversedByUserId });
    return action;
  }

  async expireDue(): Promise<number> {
    return 0;
  }

  async countAll(): Promise<number> {
    return this.actions.length;
  }

  async countByType(type: TrustAutomatedActionTypeValue): Promise<number> {
    return this.actions.filter((a) => a.type === type).length;
  }

  async countActive(): Promise<number> {
    return this.actions.filter((a) => a.status === "ACTIVE").length;
  }
}

class FakeManualReviewCaseRepository implements ManualReviewCaseRepository {
  readonly cases: ManualReviewCaseRecord[] = [];
  private idCounter = 0;

  async create(data: CreateManualReviewCaseData): Promise<ManualReviewCaseRecord> {
    const record: ManualReviewCaseRecord = {
      id: `case-${++this.idCounter}`,
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

  async assign(id: string, adminId: string): Promise<ManualReviewCaseRecord> {
    const found = this.cases.find((c) => c.id === id);
    if (!found) throw new Error("not found");
    found.assignedAdminId = adminId;
    return found;
  }

  async transition(id: string, state: ManualReviewCaseStateValue, data?: { resolvedByUserId?: string; resolutionNotes?: string }): Promise<ManualReviewCaseRecord> {
    const found = this.cases.find((c) => c.id === id);
    if (!found) throw new Error("not found");
    found.state = state;
    if (data?.resolvedByUserId) found.resolvedByUserId = data.resolvedByUserId;
    if (data?.resolutionNotes) found.resolutionNotes = data.resolutionNotes;
    if (state === "RESOLVED" || state === "REJECTED") found.resolvedAt = new Date();
    return found;
  }

  async countByState(state: ManualReviewCaseStateValue): Promise<number> {
    return this.cases.filter((c) => c.state === state).length;
  }

  async countAll(): Promise<number> {
    return this.cases.length;
  }
}

class FakeTrustAppealRepository implements TrustAppealRepository {
  readonly appeals: TrustAppealRecord[] = [];
  private idCounter = 0;

  async create(data: CreateTrustAppealData): Promise<TrustAppealRecord> {
    const record: TrustAppealRecord = {
      id: `appeal-${++this.idCounter}`,
      userId: data.userId,
      automatedActionId: data.automatedActionId,
      state: "SUBMITTED",
      userStatement: data.userStatement,
      reviewedAt: null,
      reviewedByUserId: null,
      reviewNotes: null,
      restoredAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.appeals.push(record);
    return record;
  }

  async findById(id: string): Promise<TrustAppealRecord | null> {
    return this.appeals.find((a) => a.id === id) ?? null;
  }

  async listForUser(userId: string): Promise<TrustAppealRecord[]> {
    return this.appeals.filter((a) => a.userId === userId);
  }

  async findOpenByAutomatedActionId(automatedActionId: string): Promise<TrustAppealRecord | null> {
    return this.appeals.find((a) => a.automatedActionId === automatedActionId && (a.state === "SUBMITTED" || a.state === "UNDER_REVIEW")) ?? null;
  }

  async listByState(state: AppealStateValue): Promise<TrustAppealRecord[]> {
    return this.appeals.filter((a) => a.state === state);
  }

  async transition(id: string, state: AppealStateValue, data?: { reviewedByUserId?: string; reviewNotes?: string; restoredAt?: Date }): Promise<TrustAppealRecord> {
    const found = this.appeals.find((a) => a.id === id);
    if (!found) throw new Error("not found");
    found.state = state;
    if (data?.reviewedByUserId) found.reviewedByUserId = data.reviewedByUserId;
    if (data?.reviewNotes) found.reviewNotes = data.reviewNotes;
    if (data?.restoredAt) found.restoredAt = data.restoredAt;
    return found;
  }

  async countByState(state: AppealStateValue): Promise<number> {
    return this.appeals.filter((a) => a.state === state).length;
  }

  async countAll(): Promise<number> {
    return this.appeals.length;
  }
}

class FakeAccountRestrictionRepository implements AccountRestrictionRepository {
  readonly restrictions: AccountRestrictionRecord[] = [];
  private idCounter = 0;

  async create(data: CreateAccountRestrictionData): Promise<AccountRestrictionRecord> {
    const record: AccountRestrictionRecord = {
      id: `restriction-${++this.idCounter}`,
      userId: data.userId,
      state: data.state,
      reason: data.reason,
      notes: data.notes ?? null,
      createdByUserId: data.createdByUserId ?? null,
      expiresAt: data.expiresAt,
      liftedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.restrictions.push(record);
    return record;
  }

  async findActiveForUser(userId: string): Promise<AccountRestrictionRecord | null> {
    return this.restrictions.find((r) => r.userId === userId && r.liftedAt === null) ?? null;
  }

  async lift(id: string, now: Date): Promise<AccountRestrictionRecord | null> {
    const found = this.restrictions.find((r) => r.id === id);
    if (!found) return null;
    found.liftedAt = now;
    return found;
  }

  async list(_options: ListAccountRestrictionsOptions): Promise<AccountRestrictionRecord[]> {
    return this.restrictions;
  }
}

describe("Module 65 — Trust & Integrity System integration flows", () => {
  let eventBus: RecordingEventBus;
  let trustProfiles: FakeTrustProfileRepository;
  let fraudSignals: FakeFraudSignalRepository;
  let offPlatformDetection: FakeOffPlatformDetectionRepository;
  let automatedActions: FakeTrustAutomatedActionRepository;
  let manualReviewCases: FakeManualReviewCaseRepository;
  let appeals: FakeTrustAppealRepository;
  let accountRestrictions: FakeAccountRestrictionRepository;
  let recordBehaviorSignal: RecordUserBehaviorSignalUseCase;
  let applyAutomatedAction: ApplyAutomatedActionUseCase;

  beforeEach(() => {
    eventBus = new RecordingEventBus();
    trustProfiles = new FakeTrustProfileRepository();
    fraudSignals = new FakeFraudSignalRepository();
    offPlatformDetection = new FakeOffPlatformDetectionRepository();
    automatedActions = new FakeTrustAutomatedActionRepository();
    manualReviewCases = new FakeManualReviewCaseRepository();
    appeals = new FakeTrustAppealRepository();
    accountRestrictions = new FakeAccountRestrictionRepository();
    recordBehaviorSignal = new RecordUserBehaviorSignalUseCase(trustProfiles, eventBus);
    applyAutomatedAction = new ApplyAutomatedActionUseCase(automatedActions, accountRestrictions, eventBus);
  });

  it("starts a new user at the documented default trust/risk scores", async () => {
    const profile = await trustProfiles.findOrCreateByUserId("u1");
    expect(profile.trustScore).toBe(DEFAULT_TRUST_SCORE);
    expect(profile.riskScore).toBe(DEFAULT_RISK_SCORE);
  });

  it("detecting a high-confidence off-platform signal lowers trust and raises risk, and persists the detection event", async () => {
    const useCase = new DetectOffPlatformCommunicationUseCase(
      new RuleBasedOffPlatformDetectionProvider(),
      offPlatformDetection,
      recordBehaviorSignal,
      eventBus,
    );

    const result = await useCase.execute({
      userId: "u1",
      text: "Add me on WhatsApp instead, let's continue outside the platform",
      sourceType: "MESSAGE",
      sourceId: "msg-1",
    });

    expect(result.signalsDetected).toBeGreaterThan(0);
    expect(result.highConfidence).toBe(true);
    expect(offPlatformDetection.events.length).toBe(result.signalsDetected);

    const profile = await trustProfiles.findByUserId("u1");
    expect(profile?.trustScore).toBeLessThan(DEFAULT_TRUST_SCORE);
    expect(profile?.riskScore).toBeGreaterThan(DEFAULT_RISK_SCORE);

    expect(eventBus.published.some((e) => e.eventName === "trust_integrity.off_platform.detected")).toBe(true);
    expect(eventBus.published.some((e) => e.eventName === "trust_integrity.risk_score.changed")).toBe(true);
  });

  it("a same-phone fraud cluster creates a FraudSignal for every implicated user and moves their risk score", async () => {
    const useCase = new DetectFraudSignalsUseCase(fraudSignals, recordBehaviorSignal, eventBus);
    const found = await useCase.execute({
      phoneClusters: [{ identifierHash: "phone-hash-1", userIds: ["u1", "u2"] }],
    });

    expect(found).toBe(1);
    expect(fraudSignals.signals).toHaveLength(1);
    expect(fraudSignals.signals[0]?.type).toBe("SAME_PHONE");

    for (const userId of ["u1", "u2"]) {
      const profile = await trustProfiles.findByUserId(userId);
      expect(profile?.riskScore).toBeGreaterThan(DEFAULT_RISK_SCORE);
    }
  });

  it("applying an automated action at the SUSPENSION tier records a TEMPORARY_SUSPENSION and publishes AccountSuspended", async () => {
    const result = await applyAutomatedAction.execute({
      userId: "u1",
      riskScore: RISK_SCORE_THRESHOLDS.SUSPENSION,
      reason: "FRAUD_SIGNAL_DETECTED",
      detail: "test suspension",
    });

    expect(result.applied).toBe(true);
    expect(result.primaryActionType).toBe("TEMPORARY_SUSPENSION");
    expect(automatedActions.actions).toHaveLength(1);
    expect(eventBus.published.some((e) => e.eventName === "trust_integrity.account.suspended")).toBe(true);
  });

  it("PAYMENT_ABUSE_DETECTED always applies a defensive PAYOUT_HOLD alongside the tier-driven action", async () => {
    const result = await applyAutomatedAction.execute({
      userId: "u1",
      riskScore: RISK_SCORE_THRESHOLDS.WARNING,
      reason: "PAYMENT_ABUSE_DETECTED",
      detail: "test payout hold",
    });

    expect(result.payoutHoldActionId).not.toBeNull();
    expect(automatedActions.actions.some((a) => a.type === "PAYOUT_HOLD")).toBe(true);
    expect(automatedActions.actions.some((a) => a.type === "WARNING")).toBe(true);
  });

  it("a TEMPORARY_RESTRICTION action also layers a Module 24 AccountRestriction", async () => {
    await applyAutomatedAction.execute({
      userId: "u1",
      riskScore: RISK_SCORE_THRESHOLDS.RESTRICTION,
      reason: "SPAM_ACTIVITY_DETECTED",
      detail: "test restriction",
    });

    expect(accountRestrictions.restrictions).toHaveLength(1);
    expect(accountRestrictions.restrictions[0]?.state).toBe("TEMPORARILY_BLOCKED");
  });

  it("full manual-review-to-appeal-to-reinstatement lifecycle", async () => {
    const openCase = new OpenManualReviewCaseUseCase(manualReviewCases, applyAutomatedAction, eventBus);
    const transitionCase = new TransitionManualReviewCaseUseCase(manualReviewCases, recordBehaviorSignal, eventBus);
    const submitAppeal = new SubmitAppealUseCase(appeals, automatedActions, eventBus);
    const reviewAppeal = new ReviewAppealUseCase(appeals, automatedActions, recordBehaviorSignal, eventBus);

    const reviewCase = await openCase.execute({
      userId: "u1",
      reason: "MANUAL_REVIEW_CONFIRMED",
      summary: "Suspicious multi-account activity",
      riskScore: RISK_SCORE_THRESHOLDS.MANUAL_REVIEW,
    });
    expect(reviewCase.state).toBe("OPEN");
    expect(automatedActions.actions).toHaveLength(1);
    const actionId = automatedActions.actions[0]!.id;

    await transitionCase.execute({ manualReviewCaseId: reviewCase.id, targetState: "UNDER_REVIEW", actingUserId: "admin-1" });
    const resolved = await transitionCase.execute({
      manualReviewCaseId: reviewCase.id,
      targetState: "RESOLVED",
      actingUserId: "admin-1",
      resolutionNotes: "False positive, no violation found",
      confirmed: false,
    });
    expect(resolved.state).toBe("RESOLVED");

    const appeal = await submitAppeal.execute({
      userId: "u1",
      automatedActionId: actionId,
      userStatement: "This was a false positive, I only have one account.",
    });
    expect(appeal.state).toBe("SUBMITTED");

    // A second appeal against the same still-open action is rejected.
    await expect(
      submitAppeal.execute({ userId: "u1", automatedActionId: actionId, userStatement: "duplicate" }),
    ).rejects.toThrow();

    const finalAppeal = await reviewAppeal.execute({
      appealId: appeal.id,
      decision: "APPROVED",
      reviewedByUserId: "admin-2",
      reviewNotes: "Confirmed false positive, restoring account.",
    });

    expect(finalAppeal.state).toBe("ACCOUNT_RESTORED");
    expect(automatedActions.actions.find((a) => a.id === actionId)?.status).toBe("REVERSED");
    expect(eventBus.published.some((e) => e.eventName === "trust_integrity.account.reinstated")).toBe(true);

    const profile = await trustProfiles.findByUserId("u1");
    expect(profile?.trustScore).toBeGreaterThan(DEFAULT_TRUST_SCORE - 1); // APPEAL_APPROVED restores trust
  });
});
