import { prisma } from "@/infrastructure/database/prisma/client";
import type { CustomerProfileRecord, CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";

export class PrismaCustomerProfileRepository implements CustomerProfileRepository {
  async findByUserId(userId: string): Promise<CustomerProfileRecord | null> {
    return prisma.customerProfile.findFirst({
      where: { userId, deletedAt: null },
      select: { id: true, userId: true },
    });
  }

  async findById(id: string): Promise<CustomerProfileRecord | null> {
    return prisma.customerProfile.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, userId: true },
    });
  }

  async findOrCreateByUserId(userId: string): Promise<CustomerProfileRecord> {
    const existing = await this.findByUserId(userId);
    if (existing) return existing;

    return prisma.customerProfile.create({
      data: { userId },
      select: { id: true, userId: true },
    });
  }


  // --- Module 88: GDPR Erasure Execution ---

  async eraseForUser(userId: string): Promise<void> {
    await prisma.customerProfile.updateMany({
      where: { userId },
      data: { notes: null },
    });
  }
}
