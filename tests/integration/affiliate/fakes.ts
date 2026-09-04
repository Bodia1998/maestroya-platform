import { ConflictError } from "@/domain/errors/domain-error";
import type {
  AffiliateCommissionRecord,
  AffiliateCommissionRepository,
  AffiliateCommissionStatusValue,
  AffiliateEarningsTotals,
  CreateAffiliateCommissionData,
} from "@/domain/repositories/affiliate-commission-repository";
import type {
  AffiliateCommissionReversalRecord,
  AffiliateCommissionReversalRepository,
  AffiliateCommissionReversalTypeValue,
  CreateAffiliateCommissionReversalData,
} from "@/domain/repositories/affiliate-commission-reversal-repository";
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

  async eraseForUser(userId: string): Promise<void> {
    for (const partner of this.partners.values()) {
      if (partner.userId === userId) {
        this.partners.set(partner.id, {
          ...partner,
          displayName: "Erased Partner",
          contactEmail: `erased-partner-${userId}@erased.invalid`,
          payoutDetails: null,
          notes: null,
        });
      }
    }
  }
}

export class FakeAffiliateCommissionRepository implements AffiliateCommissionRepository {
  commissions = new Map<string, AffiliateCommissionRecord>();
  /** Module 96 Financial Integrity Hardening Pass — link to the reversal
   *  ledger fake so `applyReversalAtomically` can insert into and sum from
   *  the SAME storage the test's own `FakeAffiliateCommissionReversalRepository`
   *  reads/asserts against. Set post-construction via `linkReversals` since
   *  both fakes are commonly constructed independently in test harnesses. */
  private reversalsRepo?: FakeAffiliateCommissionReversalRepository;

  linkReversals(reversals: FakeAffiliateCommissionReversalRepository): void {
    this.reversalsRepo = reversals;
  }

  async create(data: CreateAffiliateCommissionData): Promise<AffiliateCommissionRecord> {
    const now = new Date();
    const record: AffiliateCommissionRecord = {
      id: nextId("fake-affiliate-commission"),
      partnerId: data.partnerId,
      referralCode: data.referralCode,
      conversionEventId: data.conversionEventId,
      platformCommissionRefId: data.platformCommissionRefId,
      platformCommissionAmount: data.platformCommissionAmount,
      attributableCostAmount: data.attributableCostAmount,
      profitBaseAmount: data.profitBaseAmount,
      affiliateRateBps: data.affiliateRateBps,
      affiliateAmount: data.affiliateAmount,
      reversedAmount: 0,
      costFinalizationFailedAt: null,
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

  async findByPlatformCommissionRefId(platformCommissionRefId: string): Promise<AffiliateCommissionRecord | null> {
    return [...this.commissions.values()].find((c) => c.platformCommissionRefId === platformCommissionRefId) ?? null;
  }

  async recordReversal(id: string, data: { reversedAmount: number; status?: AffiliateCommissionStatusValue }): Promise<AffiliateCommissionRecord> {
    const existing = this.commissions.get(id);
    if (!existing) throw new Error(`AffiliateCommission ${id} not found`);
    const updated: AffiliateCommissionRecord = {
      ...existing,
      reversedAmount: data.reversedAmount,
      status: data.status ?? existing.status,
      updatedAt: new Date(),
    };
    this.commissions.set(id, updated);
    return updated;
  }

  /**
   * Module 96 Financial Integrity Hardening Pass — single-threaded fake
   * mirroring `PrismaAffiliateCommissionRepository.applyReversalAtomically`'s
   * OWN observable contract (idempotency fast-path, decide-under-lock,
   * append-only insert, SUM()-recomputed reversedAmount, PAID-stays-PAID)
   * so unit/fake-backed tests exercise the same behavior a real
   * transaction provides — no actual concurrency here (JS is
   * single-threaded), but the DECISION happens against the same
   * requires-a-link reversal ledger the test itself asserts against, via
   * `linkReversals`.
   */
  async applyReversalAtomically(
    affiliateCommissionId: string,
    financialAdjustmentId: string,
    decide: (current: {
      affiliateAmount: number;
      reversedAmount: number;
      status: AffiliateCommissionStatusValue;
    }) => { amount: number; reason: string | null } | null,
  ): Promise<AffiliateCommissionRecord | null> {
    if (!this.reversalsRepo) {
      throw new Error("FakeAffiliateCommissionRepository.applyReversalAtomically requires linkReversals() to be called first");
    }
    const existingReversal = await this.reversalsRepo.findByFinancialAdjustmentId(financialAdjustmentId);
    if (existingReversal) {
      return this.commissions.get(existingReversal.affiliateCommissionId) ?? null;
    }

    const current = this.commissions.get(affiliateCommissionId);
    if (!current) return null;

    const decision = decide({
      affiliateAmount: current.affiliateAmount,
      reversedAmount: current.reversedAmount,
      status: current.status,
    });
    if (!decision || decision.amount <= 0) {
      return current;
    }

    const remainingBeforeThisReversal = Math.max(0, current.affiliateAmount - current.reversedAmount);
    const type: AffiliateCommissionReversalTypeValue = decision.amount >= remainingBeforeThisReversal ? "FULL" : "PARTIAL";

    await this.reversalsRepo.createIfNotExists({
      affiliateCommissionId,
      amount: decision.amount,
      type,
      financialAdjustmentId,
      reason: decision.reason,
    });

    const newReversedAmount = Math.min(current.affiliateAmount, await this.reversalsRepo.sumForAffiliateCommission(affiliateCommissionId));
    const nextStatus: AffiliateCommissionStatusValue | undefined =
      current.status === "PAID" ? undefined : newReversedAmount >= current.affiliateAmount ? "REVERSED" : undefined;

    const updated: AffiliateCommissionRecord = {
      ...current,
      reversedAmount: newReversedAmount,
      status: nextStatus ?? current.status,
      updatedAt: new Date(),
    };
    this.commissions.set(affiliateCommissionId, updated);
    return updated;
  }

  async listForPartner(partnerId: string, filter?: { status?: AffiliateCommissionStatusValue }): Promise<AffiliateCommissionRecord[]> {
    const all = [...this.commissions.values()].filter((c) => c.partnerId === partnerId);
    return filter?.status ? all.filter((c) => c.status === filter.status) : all;
  }

  async listExpirable(asOf: Date): Promise<AffiliateCommissionRecord[]> {
    return [...this.commissions.values()].filter((c) => c.status === "PENDING" && c.expiresAt.getTime() <= asOf.getTime());
  }

  async listApprovedForPartner(partnerId: string): Promise<AffiliateCommissionRecord[]> {
    return [...this.commissions.values()].filter(
      (c) => c.partnerId === partnerId && c.status === "APPROVED" && c.payoutId === null && c.costFinalizationFailedAt === null,
    );
  }

  async listPendingFeeReconciliation(limit: number): Promise<AffiliateCommissionRecord[]> {
    return [...this.commissions.values()]
      .filter((c) => (c.status === "PENDING" || c.status === "APPROVED") && c.attributableCostAmount === 0 && c.costFinalizationFailedAt === null)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, limit);
  }

  async listFeeFinalizationOverdue(cutoff: Date, limit: number): Promise<AffiliateCommissionRecord[]> {
    return [...this.commissions.values()]
      .filter(
        (c) =>
          (c.status === "PENDING" || c.status === "APPROVED") &&
          c.attributableCostAmount === 0 &&
          c.costFinalizationFailedAt === null &&
          c.createdAt.getTime() <= cutoff.getTime(),
      )
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, limit);
  }

  async markCostFinalizationFailed(id: string, at: Date): Promise<AffiliateCommissionRecord> {
    const existing = this.commissions.get(id);
    if (!existing) throw new Error(`AffiliateCommission ${id} not found`);
    const updated: AffiliateCommissionRecord = { ...existing, costFinalizationFailedAt: at, updatedAt: new Date() };
    this.commissions.set(id, updated);
    return updated;
  }

  async releaseClaimedCommissions(payoutId: string): Promise<void> {
    for (const [id, existing] of this.commissions.entries()) {
      if (existing.payoutId === payoutId && existing.status === "APPROVED") {
        this.commissions.set(id, { ...existing, payoutId: null, updatedAt: new Date() });
      }
    }
  }

  /** Module 96 Financial Fix Pass test helper — mirrors
   *  `PrismaPartnerPayoutRepository.createBatch`'s atomic claim, used by
   *  `FakePartnerPayoutRepository.createBatch` (which does not itself
   *  hold the commission map). */
  claimForPayout(commissionIds: string[], payoutId: string): number {
    let claimed = 0;
    for (const id of commissionIds) {
      const existing = this.commissions.get(id);
      if (existing && existing.payoutId === null && existing.status === "APPROVED") {
        this.commissions.set(id, { ...existing, payoutId, updatedAt: new Date() });
        claimed += 1;
      }
    }
    return claimed;
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

  async markPaidByPayoutId(payoutId: string, paidAt: Date): Promise<void> {
    for (const [id, existing] of this.commissions.entries()) {
      if (existing.payoutId === payoutId && existing.status === "APPROVED") {
        this.commissions.set(id, { ...existing, status: "PAID", paidAt, updatedAt: new Date() });
      }
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

  /** Module 96 Financial Fix Pass — optional reference to the
   *  commission fake `createBatch` needs to atomically claim against;
   *  `undefined` keeps every pre-existing construction site (that never
   *  calls `createBatch`) compiling unchanged. */
  constructor(private readonly affiliateCommissionsForClaim?: FakeAffiliateCommissionRepository) {}

  async createBatch(data: CreatePartnerPayoutData, commissionIds: string[]): Promise<PartnerPayoutRecord> {
    const inFlight = [...this.payouts.values()].find(
      (p) => p.partnerId === data.partnerId && (p.status === "PENDING" || p.status === "PROCESSING"),
    );
    if (inFlight) {
      throw new ConflictError(`Partner "${data.partnerId}" already has a payout in progress.`);
    }

    const payout = await this.create(data);

    const claimed = this.affiliateCommissionsForClaim?.claimForPayout(commissionIds, payout.id) ?? commissionIds.length;
    if (claimed !== commissionIds.length) {
      this.payouts.delete(payout.id);
      throw new ConflictError(
        `Could not claim all ${commissionIds.length} commission(s) for this payout — ${claimed} were claimable.`,
      );
    }

    return payout;
  }

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

  async listStuckProcessing(olderThan: Date, limit: number): Promise<PartnerPayoutRecord[]> {
    return [...this.payouts.values()]
      .filter((p) => p.status === "PROCESSING" && p.updatedAt.getTime() < olderThan.getTime())
      .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())
      .slice(0, limit);
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

export class FakeAffiliateCommissionReversalRepository implements AffiliateCommissionReversalRepository {
  reversals = new Map<string, AffiliateCommissionReversalRecord>();

  async createIfNotExists(data: CreateAffiliateCommissionReversalData): Promise<AffiliateCommissionReversalRecord> {
    const existing = await this.findByFinancialAdjustmentId(data.financialAdjustmentId);
    if (existing) return existing;
    const record: AffiliateCommissionReversalRecord = {
      id: nextId("fake-affiliate-commission-reversal"),
      affiliateCommissionId: data.affiliateCommissionId,
      amount: data.amount,
      type: data.type as AffiliateCommissionReversalTypeValue,
      financialAdjustmentId: data.financialAdjustmentId,
      reason: data.reason,
      createdAt: new Date(),
    };
    this.reversals.set(record.id, record);
    return record;
  }

  async findByFinancialAdjustmentId(financialAdjustmentId: string): Promise<AffiliateCommissionReversalRecord | null> {
    return [...this.reversals.values()].find((r) => r.financialAdjustmentId === financialAdjustmentId) ?? null;
  }

  async listForAffiliateCommission(affiliateCommissionId: string): Promise<AffiliateCommissionReversalRecord[]> {
    return [...this.reversals.values()].filter((r) => r.affiliateCommissionId === affiliateCommissionId);
  }

  async sumForAffiliateCommission(affiliateCommissionId: string): Promise<number> {
    return (await this.listForAffiliateCommission(affiliateCommissionId)).reduce((sum, r) => sum + r.amount, 0);
  }
}
