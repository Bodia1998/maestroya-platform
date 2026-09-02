import { describe, expect, it, vi } from "vitest";

import type { DomainEvent } from "@/domain/events/domain-event";
import type { EventBus, EventHandler } from "@/application/ports/event-bus";
import type { DomainEventClass } from "@/domain/events/domain-event";
import type {
  TrustProfileRepository,
  TrustProfileRecord,
  ScoreEventRecord,
} from "@/domain/repositories/trust-profile-repository";
import type { FraudSignalRepository, FraudSignalRecord, CreateFraudSignalData, FraudSignalType } from "@/domain/repositories/fraud-signal-repository";
import type {
  FraudTrustSignalCheckRepository,
  FraudTrustSignalCheckRecord,
  CreateFraudTrustSignalCheckData,
  FraudTrustSignalCheckType,
} from "@/domain/repositories/fraud-trust-signal-check-repository";
import { DEFAULT_TRUST_SCORE } from "@/domain/services/trust-score-policy";
import { DEFAULT_RISK_SCORE } from "@/domain/services/risk-score-policy";

import { RecordUserBehaviorSignalUseCase } from "@/application/use-cases/trust-integrity/record-user-behavior-signal.use-case";
import { DetectFraudSignalsUseCase } from "@/application/use-cases/trust-integrity/detect-fraud-signals.use-case";
import { CollectFraudTrustSignalsUseCase } from "@/application/use-cases/trust-integrity/collect-fraud-trust-signals.use-case";
import { NullDeviceFingerprintProvider } from "@/infrastructure/trust-integrity/null-device-fingerprint-provider";
import { NullPhoneReputationProvider } from "@/infrastructure/trust-integrity/null-phone-reputation-provider";
import { IpqsVpnProxyDetectionProvider } from "@/infrastructure/trust-integrity/ipqs-vpn-proxy-detection-provider";
import { FingerprintJsDeviceFingerprintProvider } from "@/infrastructure/trust-integrity/fingerprintjs-device-fingerprint-provider";

/**
 * Module 93 — Real Fraud & Trust Signal Providers: proves requirement #18
 * end-to-end — a real provider adapter (IPQS/FingerprintJS Pro, exercised
 * here via a deterministic mocked `fetchImpl` at the HTTP boundary, never
 * a real network call) → the application port → `CollectFraudTrustSignalsUseCase`
 * → the existing `DetectFraudSignalsUseCase`/`fraud-detection-rules.ts`
 * detectors → a persisted `FraudSignal` + `FraudDetected` event + a Risk
 * Score behavior signal. Follows `trust-integrity-flows.test.ts`'s own
 * "real use cases + real domain rules, in-memory fakes for storage"
 * pattern.
 */

class RecordingEventBus implements EventBus {
  readonly published: DomainEvent[] = [];
  async publish<T extends DomainEvent>(event: T): Promise<void> {
    this.published.push(event);
  }
  async publishAll(events: DomainEvent[]): Promise<void> {
    for (const event of events) await this.publish(event);
  }
  subscribe<T extends DomainEvent>(_eventClass: DomainEventClass<T>, _handler: EventHandler<T>): void {}
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
  async updateTrustScore(trustProfileId: string, newScore: number): Promise<TrustProfileRecord> {
    const record = { ...this.findById(trustProfileId), trustScore: newScore };
    this.profiles.set(record.userId, record);
    return record;
  }
  async updateRiskScore(trustProfileId: string, newScore: number): Promise<TrustProfileRecord> {
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
  async resolve(): Promise<FraudSignalRecord> {
    throw new Error("not used in this test");
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

class FakeFraudTrustSignalCheckRepository implements FraudTrustSignalCheckRepository {
  readonly rows: FraudTrustSignalCheckRecord[] = [];
  private idCounter = 0;
  async create(data: CreateFraudTrustSignalCheckData): Promise<FraudTrustSignalCheckRecord> {
    const record: FraudTrustSignalCheckRecord = { id: `check-${++this.idCounter}`, createdAt: new Date(), ...data };
    this.rows.push(record);
    return record;
  }
  async findRecentForUser(userId: string, checkType: FraudTrustSignalCheckType): Promise<FraudTrustSignalCheckRecord | null> {
    return this.rows.find((r) => r.userId === userId && r.checkType === checkType) ?? null;
  }
  async listUserIdsForDeviceIdHash(deviceIdHash: string, excludingUserId: string): Promise<string[]> {
    return [
      ...new Set(
        this.rows
          .filter((r) => r.checkType === "DEVICE_FINGERPRINT" && r.deviceIdHash === deviceIdHash && r.userId !== excludingUserId)
          .map((r) => r.userId),
      ),
    ];
  }
  async deleteForUser(userId: string): Promise<number> {
    const before = this.rows.length;
    for (let i = this.rows.length - 1; i >= 0; i--) {
      if (this.rows[i]?.userId === userId) this.rows.splice(i, 1);
    }
    return before - this.rows.length;
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function buildHarness() {
  const trustProfiles = new FakeTrustProfileRepository();
  const fraudSignals = new FakeFraudSignalRepository();
  const signalChecks = new FakeFraudTrustSignalCheckRepository();
  const eventBus = new RecordingEventBus();
  const recordBehaviorSignal = new RecordUserBehaviorSignalUseCase(trustProfiles, eventBus);
  const detectFraudSignals = new DetectFraudSignalsUseCase(fraudSignals, recordBehaviorSignal, eventBus);
  return { trustProfiles, fraudSignals, signalChecks, eventBus, detectFraudSignals };
}

describe("Module 93 — real provider adapter → port → signal collection → existing detector (integration)", () => {
  it("a real IPQS Tor finding reaches DetectFraudSignalsUseCase and produces a persisted FraudSignal + Risk Score event", async () => {
    const { fraudSignals, signalChecks, eventBus, trustProfiles, detectFraudSignals } = buildHarness();

    const ipqsFetch = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { success: true, fraud_score: 92, proxy: true, vpn: false, tor: true, connection_type: "Corporate" }));
    const vpnProxyProvider = new IpqsVpnProxyDetectionProvider({ apiKey: "test-key", fetchImpl: ipqsFetch, sleep: async () => {} });

    const useCase = new CollectFraudTrustSignalsUseCase(
      new NullDeviceFingerprintProvider(),
      vpnProxyProvider,
      new NullPhoneReputationProvider(),
      signalChecks,
      detectFraudSignals,
    );

    const result = await useCase.execute({ userId: "u1", vpnProxySignal: { ipHash: "hash-1", ip: "203.0.113.4" } });

    expect(ipqsFetch).toHaveBeenCalledTimes(1);
    expect(result.fraudSignalsDetected).toBe(1);
    expect(fraudSignals.signals).toHaveLength(1);
    expect(fraudSignals.signals[0]).toMatchObject({ type: "SUSPICIOUS_VPN_PROXY_ACCESS", userId: "u1" });
    expect(eventBus.published.some((e) => e.constructor.name === "FraudDetected")).toBe(true);

    const profile = await trustProfiles.findByUserId("u1");
    expect(profile?.riskScore).toBeGreaterThan(DEFAULT_RISK_SCORE);

    // Data minimization: the persisted check row never carries the raw IP.
    expect(JSON.stringify(signalChecks.rows)).not.toContain("203.0.113.4");
  });

  it("a real FingerprintJS device match across two users produces a SAME_DEVICE FraudSignal", async () => {
    const { fraudSignals, signalChecks, detectFraudSignals } = buildHarness();

    const fpjsFetch = vi.fn().mockImplementation(async () =>
      jsonResponse(200, { products: { identification: { data: { visitorId: "visitor_shared", confidence: { score: 0.99 } } } } }),
    );
    const deviceProvider = new FingerprintJsDeviceFingerprintProvider({ secretApiKey: "test-key", fetchImpl: fpjsFetch, sleep: async () => {} });

    const useCase = new CollectFraudTrustSignalsUseCase(
      deviceProvider,
      { name: "NULL", classify: async () => ({ classification: "UNKNOWN", confidence: 0, isVpn: null, isProxy: null, isTor: null, isHosting: null, riskLevel: "UNKNOWN", provider: "NULL", checkedAt: new Date() }) },
      new NullPhoneReputationProvider(),
      signalChecks,
      detectFraudSignals,
    );

    await useCase.execute({ userId: "u1", deviceSignal: { rawSignal: { requestId: "req_1" } } });
    const second = await useCase.execute({ userId: "u2", deviceSignal: { rawSignal: { requestId: "req_2" } } });

    expect(second.fraudSignalsDetected).toBe(1);
    expect(fraudSignals.signals).toHaveLength(1);
    expect(fraudSignals.signals[0]?.type).toBe("SAME_DEVICE");
    expect([fraudSignals.signals[0]?.userId, ...(fraudSignals.signals[0]?.relatedUserIds ?? [])].sort()).toEqual(["u1", "u2"]);
  });

  it("a provider outage never produces a fraud signal and never throws (signal unavailable, not fraud)", async () => {
    const { fraudSignals, signalChecks, detectFraudSignals } = buildHarness();

    const failingFetch = vi.fn().mockResolvedValue(jsonResponse(500, {}));
    const vpnProxyProvider = new IpqsVpnProxyDetectionProvider({
      apiKey: "test-key",
      fetchImpl: failingFetch,
      sleep: async () => {},
      maxAttempts: 1,
    });

    const useCase = new CollectFraudTrustSignalsUseCase(
      new NullDeviceFingerprintProvider(),
      vpnProxyProvider,
      new NullPhoneReputationProvider(),
      signalChecks,
      detectFraudSignals,
    );

    const result = await useCase.execute({ userId: "u1", vpnProxySignal: { ipHash: "hash-1", ip: "203.0.113.4" } });

    expect(result.vpnProxy).toMatchObject({ attempted: true, success: false });
    expect(fraudSignals.signals).toHaveLength(0);
    expect(signalChecks.rows).toHaveLength(1);
    expect(signalChecks.rows[0]?.success).toBe(false);
  });
});
