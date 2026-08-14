import type {
  AffiliateCommissionRecord,
  AffiliateCommissionRepository,
  AffiliateCommissionStatusValue,
  AffiliateEarningsTotals,
  CreateAffiliateCommissionData,
} from "@/domain/repositories/affiliate-commission-repository";
import type {
  CreatePartnerFraudFlagData,
  PartnerFraudFlagRecord,
  PartnerFraudFlagRepository,
} from "@/domain/repositories/partner-fraud-flag-repository";
import type {
  CreatePartnerPayoutData,
  PartnerPayoutRecord,
  PartnerPayoutRepository,
  PartnerPayoutStatusValue,
} from "@/domain/repositories/partner-payout-repository";
import type {
  CreatePartnerData,
  PartnerRecord,
  PartnerRepository,
  PartnerStatusValue,
  UpdatePartnerStatusData,
} from "@/domain/repositories/partner-repository";

/**
 * In-memory test doubles for Module 61 — Affiliate & Partner System
 * integration tests. Same pattern as tests/integration/referral/fakes.ts —
 * implement the real repository interfaces so the use cases under test run
 * their genuine orchestration logic, with only storage swapped out.
 */
let idCounter = 0;
function nextId(prefix: string) {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

export class FakePartnerRepository implements PartnerRepository {
  partners = new Map<string, PartnerRecord>();

  async create(data: CreatePartnerData): Promise<PartnerRecord> {
    const now = new Date();
    const record: PartnerRecord = {
      id: nextId("fake-partner"),
      userId: data.userId,
      type: data.type,
      status: "PENDING",
      displayName: data.displayName,
      contactEmail: data.contactEmail,
      payoutMethod: data.payoutMethod ?? "MANUAL",
      payoutDetails: data.payoutDetails ?? null,
      minimumPayoutThreshold: data.minimumPayoutThreshold ?? 50,
      notes: null,
      approvedAt: null,
      approvedByUserId: null,
      rejectedAt: null,
      rejectedReason: null,
      suspendedAt: null,
      suspendedReason: null,
      bannedAt: null,
      bannedReason: null,
      createdAt: now,
      updatedAt: now,
    };
    this.partners.set(record.id, record);
    return record;
  }

  async findById(id: string): Promise<PartnerRecord | null> {
    return this.partners.get(id) ?? null;
  }

  async findByUserId(userId: string): Promise<PartnerRecord | null> {
    return [...this.partners.values()].find((p) => p.userId === userId) ?? null;
  }

  async updateStatus(id: string, data: UpdatePartnerStatusData): Promise<PartnerRecord> {
    const existing = this.partners.get(id);
    if (!existing) throw new Error(`Partner ${id} not found`);
    const updated: PartnerRecord = { ...existing, ...data, updatedAt: new Date() };
    this.partners.set(id, updated);
    return updated;
  }

  async list(filter?: { status?: PartnerStatusValue }): Promise<PartnerRecord[]> {
    const all = [...this.partners.values()];
    return filter?.status ? all.filter((p) => p.status === filter.status) : all;
  }

  async countByStatus(status: PartnerStatusValue): Promise<number> {
    return [...this.partners.values()].filter((p) => p.status === status).length;
  }
}

export class FakeAffiliateCommissionRepository implements AffiliateCommissionRepository {
  commissions = new Map<string, AffiliateCommissionRecord>();

  async create(data: CreateAffiliateCommissionData): Promise<AffiliateCommissionRecord> {
    const now = new Date();
    const record: AffiliateCommissionRecord = {
      id: nextId("fake-affiliate-commission"),
      partnerId: data.partnerId,
      referralCode: data.referralCode,
      conversionEventId: data.conversionEventId,
      platformCommissionRefId: data.platformCommissionRefId,
      platformCommissionAmount: data.platformCommissionAmount,
      affiliateRateBps: data.affiliateRateBps,
      affiliateAmount: data.affiliateAmount,
      status: "PENDING",
      approvedAt: null,
      cancelledAt: null,
      cancelReason: null,
      expiresAt: data.expiresAt,
      expiredAt: null,
      paidAt: null,
      payoutId: null,
      createdAt: now,
      updatedAt: now,
    };
    this.commissions.set(record.id, record);
    return record;
  }

  async findById(id: string): Promise<AffiliateCommissionRecord | null> {
    return this.commissions.get(id) ?? null;
  }

  async findByConversionEventId(conversionEventId: string): Promise<AffiliateCommissionRecord | null> {
    return [...this.commissions.values()].find((c) => c.conversionEventId === conversionEventId) ?? null;
  }

  async listForPartner(partnerId: string, filter?: { status?: AffiliateCommissionStatusValue }): Promise<AffiliateCommissionRecord[]> {
    const all = [...this.commissions.values()].filter((c) => c.partnerId === partnerId);
    return filter?.status ? all.filter((c) => c.status === filter.status) : all;
  }

  async listExpirable(asOf: Date): Promise<AffiliateCommissionRecord[]> {
    return [...this.commissions.values()].filter((c) => c.status === "PENDING" && c.expiresAt.getTime() <= asOf.getTime());
  }

  async listApprovedForPartner(partnerId: string): Promise<AffiliateCommissionRecord[]> {
    return [...this.commissions.values()].filter((c) => c.partnerId === partnerId && c.status === "APPROVED");
  }

  async updateStatus(
    id: string,
    data: {
      status: AffiliateCommissionStatusValue;
      approvedAt?: Date | null;
      cancelledAt?: Date | null;
      cancelReason?: string | null;
      expiredAt?: Date | null;
      paidAt?: Date | null;
      payoutId?: string | null;
    },
  ): Promise<AffiliateCommissionRecord> {
    const existing = this.commissions.get(id);
    if (!existing) throw new Error(`AffiliateCommission ${id} not found`);
    const updated: AffiliateCommissionRecord = { ...existing, ...data, updatedAt: new Date() };
    this.commissions.set(id, updated);
    return updated;
  }

  async markPaidByIds(ids: string[], payoutId: string, paidAt: Date): Promise<void> {
    for (const id of ids) {
      const existing = this.commissions.get(id);
      if (!existing) continue;
      this.commissions.set(id, { ...existing, status: "PAID", payoutId, paidAt, updatedAt: new Date() });
    }
  }

  async totalsForPartner(partnerId: string): Promise<AffiliateEarningsTotals> {
    const all = [...this.commissions.values()].filter((c) => c.partnerId === partnerId);
    return {
      pendingTotal: all.filter((c) => c.status === "PENDING").reduce((s, c) => s + c.affiliateAmount, 0),
      approvedTotal: all.filter((c) => c.status === "APPROVED").reduce((s, c) => s + c.affiliateAmount, 0),
      paidTotal: all.filter((c) => c.status === "PAID").reduce((s, c) => s + c.affiliateAmount, 0),
    };
  }
}

export class FakePartnerPayoutRepository implements PartnerPayoutRepository {
  payouts = new Map<string, PartnerPayoutRecord>();

  async create(data: CreatePartnerPayoutData): Promise<PartnerPayoutRecord> {
    const now = new Date();
    const record: PartnerPayoutRecord = {
      id: nextId("fake-payout"),
      partnerId: data.partnerId,
      amount: data.amount,
      currency: data.currency ?? "EUR",
      method: data.method,
      status: "PENDING",
      reference: null,
      periodStart: data.periodStart,
      periodEnd: data.periodEnd,
      processedAt: null,
      failureReason: null,
      createdAt: now,
      updatedAt: now,
    };
    this.payouts.set(record.id, record);
    return record;
  }

  async findById(id: string): Promise<PartnerPayoutRecord | null> {
    return this.payouts.get(id) ?? null;
  }

  async listForPartner(partnerId: string): Promise<PartnerPayoutRecord[]> {
    return [...this.payouts.values()].filter((p) => p.partnerId === partnerId);
  }

  async updateStatus(
    id: string,
    data: { status: PartnerPayoutStatusValue; reference?: string | null; processedAt?: Date | null; failureReason?: string | null },
  ): Promise<PartnerPayoutRecord> {
    const existing = this.payouts.get(id);
    if (!existing) throw new Error(`PartnerPayout ${id} not found`);
    const updated: PartnerPayoutRecord = { ...existing, ...data, updatedAt: new Date() };
    this.payouts.set(id, updated);
    return updated;
  }
}

export class FakePartnerFraudFlagRepository implements PartnerFraudFlagRepository {
  flags = new Map<string, PartnerFraudFlagRecord>();

  async create(data: CreatePartnerFraudFlagData): Promise<PartnerFraudFlagRecord> {
    const record: PartnerFraudFlagRecord = {
      id: nextId("fake-fraud-flag"),
      partnerId: data.partnerId,
      type: data.type,
      status: "OPEN",
      detail: data.detail,
      relatedReferralCode: data.relatedReferralCode ?? null,
      relatedVisitorId: data.relatedVisitorId ?? null,
      relatedUserId: data.relatedUserId ?? null,
      resolvedAt: null,
      resolvedByUserId: null,
      resolution: null,
      createdAt: new Date(),
    };
    this.flags.set(record.id, record);
    return record;
  }

  async listForPartner(partnerId: string): Promise<PartnerFraudFlagRecord[]> {
    return [...this.flags.values()].filter((f) => f.partnerId === partnerId);
  }

  async listOpen(): Promise<PartnerFraudFlagRecord[]> {
    return [...this.flags.values()].filter((f) => f.status === "OPEN");
  }

  async resolve(
    id: string,
    data: { status: "REVIEWED" | "DISMISSED" | "CONFIRMED"; resolvedByUserId: string; resolution: string },
  ): Promise<PartnerFraudFlagRecord> {
    const existing = this.flags.get(id);
    if (!existing) throw new Error(`PartnerFraudFlag ${id} not found`);
    const updated: PartnerFraudFlagRecord = { ...existing, ...data, resolvedAt: new Date() };
    this.flags.set(id, updated);
    return updated;
  }

  async countOpenForPartner(partnerId: string): Promise<number> {
    return [...this.flags.values()].filter((f) => f.partnerId === partnerId && f.status === "OPEN").length;
  }
}
