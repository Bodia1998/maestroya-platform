import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  AddressRecord,
  AddressRepository,
  UpsertAddressData,
} from "@/domain/repositories/address-repository";

export class PrismaAddressRepository implements AddressRepository {
  async findPrimaryByUserId(userId: string): Promise<AddressRecord | null> {
    return prisma.address.findFirst({
      where: { userId, deletedAt: null },
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
      select: {
        id: true,
        line1: true,
        line2: true,
        city: true,
        province: true,
        postalCode: true,
        country: true,
      },
    });
  }

  async upsertPrimaryForUser(userId: string, data: UpsertAddressData): Promise<AddressRecord> {
    const existing = await prisma.address.findFirst({
      where: { userId, deletedAt: null, isDefault: true },
      select: { id: true },
    });

    const addressData = {
      line1: data.line1,
      line2: data.line2 ?? null,
      city: data.city,
      province: data.province ?? null,
      postalCode: data.postalCode,
      country: data.country,
    };

    if (existing) {
      return prisma.address.update({
        where: { id: existing.id },
        data: addressData,
        select: {
          id: true,
          line1: true,
          line2: true,
          city: true,
          province: true,
          postalCode: true,
          country: true,
        },
      });
    }

    return prisma.address.create({
      data: {
        ...addressData,
        userId,
        type: "HOME",
        isDefault: true,
      },
      select: {
        id: true,
        line1: true,
        line2: true,
        city: true,
        province: true,
        postalCode: true,
        country: true,
      },
    });
  }
}
