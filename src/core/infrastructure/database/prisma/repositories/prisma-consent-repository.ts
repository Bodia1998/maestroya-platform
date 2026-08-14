import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  ConsentRecord,
  ConsentRepository,
  CreateConsentData,
} from "@/domain/repositories/consent-repository";
import type { ConsentTypeValue } from "@/domain/value-objects/consent-type";

/**
 * Module 38 — GDPR Compliance: Prisma implementation of `ConsentRepository`
 * over the `Consent` model (`prisma/schema.prisma`).
 */
export class PrismaConsentRepository implements ConsentRepository {
  async findActiveByUserAndType(userId: string, type: ConsentTypeValue): Promise<ConsentRecord | null> {
    return prisma.consent.findFirst({
      where: { userId, type, withdrawnAt: null },
      orderBy: { grantedAt: "desc" },
    });
  }

  async listByUser(userId: string): Promise<ConsentRecord[]> {
    return prisma.consent.findMany({
      where: { userId },
      orderBy: { grantedAt: "desc" },
    });
  }

  async create(data: CreateConsentData): Promise<ConsentRecord> {
    return prisma.consent.create({
      data: {
        userId: data.userId,
        type: data.type,
        version: data.version,
        grantedAt: data.grantedAt,
        // Module 62 — Professional Onboarding: additive, optional
        // provenance columns — `undefined` (every pre-Module-62 caller)
        // lets Prisma fall back to the column default (`null`).
        ipHash: data.ipHash ?? null,
        userAgent: data.userAgent ?? null,
      },
    });
  }

  async withdraw(id: string, withdrawnAt: Date): Promise<ConsentRecord> {
    const existing = await prisma.consent.findUnique({ where: { id } });
    if (existing?.withdrawnAt) {
      // Idempotent: already withdrawn — see ConsentRepository.withdraw's
      // own doc comment for why this is a no-op rather than an error.
      return existing;
    }
    return prisma.consent.update({
      where: { id },
      data: { withdrawnAt },
    });
  }
}
