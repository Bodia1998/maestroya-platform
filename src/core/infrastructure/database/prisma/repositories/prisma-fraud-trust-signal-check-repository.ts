import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  CreateFraudTrustSignalCheckData,
  FraudTrustSignalCheckRecord,
  FraudTrustSignalCheckRepository,
  FraudTrustSignalCheckType,
} from "@/domain/repositories/fraud-trust-signal-check-repository";

/** Module 93 — Real Fraud & Trust Signal Providers: Prisma implementation
 *  backed by `fraud_trust_signal_checks` — mirrors `PrismaFraudSignalRepository`'s
 *  own shape. */
export class PrismaFraudTrustSignalCheckRepository implements FraudTrustSignalCheckRepository {
  async create(data: CreateFraudTrustSignalCheckData): Promise<FraudTrustSignalCheckRecord> {
    const row = await prisma.fraudTrustSignalCheck.create({
      data: {
        userId: data.userId,
        checkType: data.checkType,
        provider: data.provider,
        success: data.success,
        latencyMs: data.latencyMs ?? null,
        deviceIdHash: data.deviceIdHash ?? null,
        deviceConfidence: data.deviceConfidence ?? null,
        ipHash: data.ipHash ?? null,
        vpnClassification: data.vpnClassification ?? null,
        vpnRiskLevel: data.vpnRiskLevel ?? null,
        vpnConfidence: data.vpnConfidence ?? null,
        isVpn: data.isVpn ?? null,
        isProxy: data.isProxy ?? null,
        isTor: data.isTor ?? null,
        isHosting: data.isHosting ?? null,
        phoneValid: data.phoneValid ?? null,
        phoneLineType: data.phoneLineType ?? null,
        phoneRiskScore: data.phoneRiskScore ?? null,
      },
    });
    return row as FraudTrustSignalCheckRecord;
  }

  async findRecentForUser(
    userId: string,
    checkType: FraudTrustSignalCheckType,
    withinMs: number,
    now: Date = new Date(),
  ): Promise<FraudTrustSignalCheckRecord | null> {
    const row = await prisma.fraudTrustSignalCheck.findFirst({
      where: { userId, checkType, createdAt: { gte: new Date(now.getTime() - withinMs) } },
      orderBy: { createdAt: "desc" },
    });
    return row as FraudTrustSignalCheckRecord | null;
  }

  async listUserIdsForDeviceIdHash(deviceIdHash: string, excludingUserId: string): Promise<string[]> {
    const rows = await prisma.fraudTrustSignalCheck.findMany({
      where: { deviceIdHash, checkType: "DEVICE_FINGERPRINT", userId: { not: excludingUserId } },
      select: { userId: true },
      distinct: ["userId"],
    });
    return rows.map((r: { userId: string }) => r.userId);
  }

  async deleteForUser(userId: string): Promise<number> {
    const result = await prisma.fraudTrustSignalCheck.deleteMany({ where: { userId } });
    return result.count;
  }
}
