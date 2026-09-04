import type { CreateReferralCodeData, ReferralCodeRecord, ReferralCodeRepository } from "@/domain/repositories/referral-code-repository";
import type {
  CreateReferralVisitData,
  ReferralVisitRecord,
  ReferralVisitRepository,
  TopCampaignStat,
  TopReferralCodeStat,
} from "@/domain/repositories/referral-visit-repository";
import type { MarketingAttributionRecord, MarketingAttributionRepository } from "@/domain/repositories/marketing-attribution-repository";
import type {
  ConversionEventRecord,
  ConversionEventRepository,
  ConversionTypeValue,
  RecordConversionEventData,
} from "@/domain/repositories/conversion-event-repository";
import type { AttributionTouchState } from "@/domain/services/marketing-attribution-touch-rules";

/**
 * In-memory test doubles for Module 60 — Referral & Marketing Attribution
 * Platform integration tests. Same pattern as
 * tests/integration/verification/fakes.ts: implement the real repository
 * interfaces so the use cases under test run their genuine orchestration
 * logic, with only storage swapped out.
 */
let idCounter = 0;
function nextId(prefix: string) {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

export class FakeReferralCodeRepository implements ReferralCodeRepository {
  codes = new Map<string, ReferralCodeRecord>();

  async create(data: CreateReferralCodeData): Promise<ReferralCodeRecord> {
    const record: ReferralCodeRecord = {
      id: nextId("fake-referral-code"),
      code: data.code,
      ownerUserId: data.ownerUserId ?? null,
      label: data.label ?? null,
      source: data.source ?? null,
      isActive: true,
      createdAt: new Date(),
    };
    this.codes.set(record.id, record);
    return record;
  }

  async findByCode(code: string): Promise<ReferralCodeRecord | null> {
    return [...this.codes.values()].find((c) => c.code === code) ?? null;
  }

  async findById(id: string): Promise<ReferralCodeRecord | null> {
    return this.codes.get(id) ?? null;
  }

  async list(): Promise<ReferralCodeRecord[]> {
    return [...this.codes.values()];
  }

  async findByOwnerUserId(ownerUserId: string): Promise<ReferralCodeRecord[]> {
    return [...this.codes.values()].filter((c) => c.ownerUserId === ownerUserId);
  }

  async setActive(id: string, isActive: boolean): Promise<void> {
    const existing = this.codes.get(id);
    if (existing) this.codes.set(id, { ...existing, isActive });
  }
}

export class FakeReferralVisitRepository implements ReferralVisitRepository {
  visits: ReferralVisitRecord[] = [];

  async create(data: CreateReferralVisitData): Promise<ReferralVisitRecord> {
    const record: ReferralVisitRecord = { id: nextId("fake-visit"), createdAt: new Date(), ...data };
    this.visits.push(record);
    return record;
  }

  async findRecentByVisitor(visitorId: string, since: Date): Promise<ReferralVisitRecord[]> {
    return this.visits.filter((v) => v.visitorId === visitorId && v.createdAt.getTime() >= since.getTime());
  }

  async countAll(): Promise<number> {
    return this.visits.length;
  }

  async topReferralCodesByVisits(limit: number): Promise<TopReferralCodeStat[]> {
    const counts = new Map<string, number>();
    for (const v of this.visits) {
      if (!v.referralCode) continue;
      counts.set(v.referralCode, (counts.get(v.referralCode) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([referralCode, visits]) => ({ referralCode, visits }))
      .sort((a, b) => b.visits - a.visits)
      .slice(0, limit);
  }

  async topCampaignsByVisits(limit: number): Promise<TopCampaignStat[]> {
    const counts = new Map<string, number>();
    for (const v of this.visits) {
      if (!v.utmCampaign) continue;
      counts.set(v.utmCampaign, (counts.get(v.utmCampaign) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([campaign, visits]) => ({ campaign, visits }))
      .sort((a, b) => b.visits - a.visits)
      .slice(0, limit);
  }

  async listByReferralCodes(codes: string[]): Promise<ReferralVisitRecord[]> {
    if (codes.length === 0) return [];
    return this.visits.filter((v) => v.referralCode !== null && codes.includes(v.referralCode));
  }
}

export class FakeMarketingAttributionRepository implements MarketingAttributionRepository {
  attributions = new Map<string, MarketingAttributionRecord>();

  async findByVisitorId(visitorId: string): Promise<MarketingAttributionRecord | null> {
    return [...this.attributions.values()].find((a) => a.visitorId === visitorId) ?? null;
  }

  async findByUserId(userId: string): Promise<MarketingAttributionRecord | null> {
    return [...this.attributions.values()].find((a) => a.userId === userId) ?? null;
  }

  async upsertTouchState(visitorId: string, state: AttributionTouchState): Promise<MarketingAttributionRecord> {
    const existing = await this.findByVisitorId(visitorId);
    const now = new Date();
    const record: MarketingAttributionRecord = existing
      ? { ...existing, ...state, updatedAt: now }
      : { id: nextId("fake-attribution"), visitorId, userId: null, createdAt: now, updatedAt: now, ...state };
    this.attributions.set(record.id, record);
    return record;
  }

  async linkUser(visitorId: string, userId: string): Promise<void> {
    const existing = await this.findByVisitorId(visitorId);
    if (!existing || existing.userId) return;
    this.attributions.set(existing.id, { ...existing, userId, updatedAt: new Date() });
  }

  async countTotal(): Promise<number> {
    return this.attributions.size;
  }

  async countWithUser(): Promise<number> {
    return [...this.attributions.values()].filter((a) => a.userId !== null).length;
  }

  async listByReferralCodes(codes: string[]): Promise<MarketingAttributionRecord[]> {
    if (codes.length === 0) return [];
    return [...this.attributions.values()].filter(
      (a) => (a.firstReferralCode && codes.includes(a.firstReferralCode)) || (a.lastReferralCode && codes.includes(a.lastReferralCode)),
    );
  }

  async eraseForUser(userId: string): Promise<void> {
    for (const attribution of this.attributions.values()) {
      if (attribution.userId === userId) {
        this.attributions.set(attribution.id, { ...attribution, userId: null, updatedAt: new Date() });
      }
    }
  }
}

export class FakeConversionEventRepository implements ConversionEventRepository {
  events: ConversionEventRecord[] = [];

  async create(data: RecordConversionEventData): Promise<ConversionEventRecord> {
    const record: ConversionEventRecord = {
      id: nextId("fake-conversion"),
      attributionId: data.attributionId,
      type: data.type,
      occurredAt: data.occurredAt,
      referenceId: data.referenceId ?? null,
      revenueAmount: data.revenueAmount ?? null,
      createdAt: new Date(),
    };
    this.events.push(record);
    return record;
  }

  async findByReferenceId(type: ConversionTypeValue, referenceId: string): Promise<ConversionEventRecord | null> {
    return this.events.find((e) => e.type === type && e.referenceId === referenceId) ?? null;
  }

  async listByAttributionId(attributionId: string): Promise<ConversionEventRecord[]> {
    return this.events.filter((e) => e.attributionId === attributionId);
  }

  async countByType(type: ConversionTypeValue): Promise<number> {
    return this.events.filter((e) => e.type === type).length;
  }

  async sumRevenueByType(type: ConversionTypeValue): Promise<number> {
    return this.events.filter((e) => e.type === type).reduce((sum, e) => sum + (e.revenueAmount ?? 0), 0);
  }
}
