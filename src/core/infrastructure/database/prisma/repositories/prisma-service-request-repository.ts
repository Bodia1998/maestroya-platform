import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  CreateServiceRequestData,
  RequestPhotoRecord,
  ServiceRequestLocation,
  ServiceRequestRecord,
  ServiceRequestRepository,
  ServiceRequestStatusValue,
  UpdateServiceRequestFields,
} from "@/domain/repositories/service-request-repository";

const SELECT = {
  id: true,
  customerId: true,
  categoryId: true,
  title: true,
  description: true,
  status: true,
  urgency: true,
  budgetMin: true,
  budgetMax: true,
  expiresAt: true,
  createdAt: true,
  updatedAt: true,
  category: { select: { name: true } },
  address: {
    select: {
      line1: true,
      line2: true,
      city: true,
      province: true,
      postalCode: true,
      country: true,
      latitude: true,
      longitude: true,
    },
  },
  photos: {
    select: { id: true, url: true, caption: true, sortOrder: true },
    orderBy: { sortOrder: "asc" as const },
  },
} as const;

type PrismaServiceRequestRow = {
  id: string;
  customerId: string;
  categoryId: string;
  title: string;
  description: string;
  status: string;
  urgency: string;
  budgetMin: unknown;
  budgetMax: unknown;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  category: { name: string };
  address: {
    line1: string;
    line2: string | null;
    city: string;
    province: string | null;
    postalCode: string;
    country: string;
    latitude: number | null;
    longitude: number | null;
  };
  photos: { id: string; url: string; caption: string | null; sortOrder: number }[];
};

function toRecord(row: PrismaServiceRequestRow): ServiceRequestRecord {
  return {
    id: row.id,
    customerId: row.customerId,
    categoryId: row.categoryId,
    categoryName: row.category.name,
    title: row.title,
    description: row.description,
    status: row.status as ServiceRequestStatusValue,
    urgency: row.urgency as ServiceRequestRecord["urgency"],
    // Decimal(10,2) columns — converted to plain numbers at the
    // repository boundary, same convention as PrismaProfessionalRepository.
    budgetMin: row.budgetMin === null ? null : Number(row.budgetMin),
    budgetMax: row.budgetMax === null ? null : Number(row.budgetMax),
    expiresAt: row.expiresAt,
    location: {
      line1: row.address.line1,
      line2: row.address.line2,
      city: row.address.city,
      province: row.address.province,
      postalCode: row.address.postalCode,
      country: row.address.country,
      latitude: row.address.latitude,
      longitude: row.address.longitude,
    },
    photos: row.photos.map((p) => ({ id: p.id, url: p.url, caption: p.caption, sortOrder: p.sortOrder })),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toPhotoRecord(row: { id: string; url: string; caption: string | null; sortOrder: number }): RequestPhotoRecord {
  return { id: row.id, url: row.url, caption: row.caption, sortOrder: row.sortOrder };
}

export class PrismaServiceRequestRepository implements ServiceRequestRepository {
  async findById(id: string): Promise<ServiceRequestRecord | null> {
    const row = await prisma.serviceRequest.findFirst({
      where: { id, deletedAt: null },
      select: SELECT,
    });
    return row ? toRecord(row) : null;
  }

  async findManyByCustomerId(customerId: string): Promise<ServiceRequestRecord[]> {
    const rows = await prisma.serviceRequest.findMany({
      where: { customerId, deletedAt: null },
      select: SELECT,
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toRecord);
  }

  async create(customerId: string, userId: string, data: CreateServiceRequestData): Promise<ServiceRequestRecord> {
    // Address is created as its own row first (rather than via a nested
    // `address: { create }` on serviceRequest.create) because ServiceRequest
    // is owned via the scalar `customerId`/`categoryId` FKs (the "unchecked"
    // create input) — mixing those scalars with a nested relation write for
    // `address` in the same `data` object isn't a valid Prisma input shape
    // (the checked/unchecked create inputs are mutually exclusive per
    // relation). Same two-step approach as PrismaAddressRepository.
    const address = await prisma.address.create({
      data: {
        userId,
        type: "SERVICE_LOCATION",
        line1: data.location.line1,
        line2: data.location.line2,
        city: data.location.city,
        province: data.location.province,
        postalCode: data.location.postalCode,
        country: data.location.country,
        latitude: data.location.latitude,
        longitude: data.location.longitude,
      },
      select: { id: true },
    });

    const row = await prisma.serviceRequest.create({
      data: {
        customerId,
        categoryId: data.categoryId,
        addressId: address.id,
        title: data.title,
        description: data.description,
        status: "PUBLISHED",
        urgency: data.urgency,
        budgetMin: data.budgetMin,
        budgetMax: data.budgetMax,
        publishedAt: new Date(),
      },
      select: SELECT,
    });
    return toRecord(row);
  }

  async update(id: string, data: UpdateServiceRequestFields): Promise<ServiceRequestRecord> {
    // Same reasoning as create(): categoryId is a scalar (unchecked-only)
    // field, so the address row is updated with its own call instead of a
    // nested `address: { update }`, which would only be valid alongside the
    // checked `category`/`customer` relation objects, not scalar `categoryId`.
    if (data.location) {
      const existing = await prisma.serviceRequest.findUniqueOrThrow({
        where: { id },
        select: { addressId: true },
      });
      await prisma.address.update({
        where: { id: existing.addressId },
        data: this.toAddressUpdateData(data.location),
      });
    }

    const row = await prisma.serviceRequest.update({
      where: { id },
      data: {
        categoryId: data.categoryId,
        title: data.title,
        description: data.description,
        urgency: data.urgency,
        budgetMin: data.budgetMin,
        budgetMax: data.budgetMax,
      },
      select: SELECT,
    });
    return toRecord(row);
  }

  private toAddressUpdateData(location: ServiceRequestLocation) {
    return {
      line1: location.line1,
      line2: location.line2,
      city: location.city,
      province: location.province,
      postalCode: location.postalCode,
      country: location.country,
      latitude: location.latitude,
      longitude: location.longitude,
    };
  }

  async updateStatus(id: string, status: ServiceRequestStatusValue): Promise<void> {
    await prisma.serviceRequest.update({ where: { id }, data: { status } });
  }

  async findExpirable(now: Date): Promise<ServiceRequestRecord[]> {
    const rows = await prisma.serviceRequest.findMany({
      where: {
        deletedAt: null,
        status: { in: ["PUBLISHED", "QUOTED"] },
        expiresAt: { lte: now },
      },
      select: SELECT,
    });
    return rows.map(toRecord);
  }

  async addPhoto(serviceRequestId: string, url: string, caption: string | null): Promise<RequestPhotoRecord> {
    const sortOrder = await prisma.requestPhoto.count({ where: { serviceRequestId } });
    const row = await prisma.requestPhoto.create({
      data: { serviceRequestId, url, caption, sortOrder },
      select: { id: true, url: true, caption: true, sortOrder: true },
    });
    return toPhotoRecord(row);
  }

  async removePhoto(serviceRequestId: string, photoId: string): Promise<void> {
    await prisma.requestPhoto.deleteMany({ where: { id: photoId, serviceRequestId } });
  }

  async countPhotos(serviceRequestId: string): Promise<number> {
    return prisma.requestPhoto.count({ where: { serviceRequestId } });
  }
}
