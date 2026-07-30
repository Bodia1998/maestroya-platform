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
        latitude: true,
        longitude: true,
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
      // Deliberately `data.latitude`/`data.longitude` as-is (not `?? null`):
      // leaving them `undefined` when a caller doesn't supply them (e.g.
      // the Profile module's own address-edit form, which never resolves
      // coordinates) means Prisma omits the field entirely from `update`,
      // preserving whatever coordinates Professional Onboarding's geocoding
      // step may have already set — not silently wiping them out.
      latitude: data.latitude,
      longitude: data.longitude,
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
          latitude: true,
          longitude: true,
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
        latitude: true,
        longitude: true,
      },
    });
  }
}
