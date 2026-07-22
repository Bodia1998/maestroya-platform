import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  CreateProfessionalData,
  ProfessionalRecord,
  ProfessionalRepository,
  ProfessionalStatusValue,
  UpdateProfessionalData,
} from "@/domain/repositories/professional-repository";

const SELECT = {
  id: true,
  userId: true,
  businessName: true,
  bio: true,
  headline: true,
  yearsExperience: true,
  hourlyRate: true,
  serviceRadiusKm: true,
  contactEmail: true,
  contactPhone: true,
  websiteUrl: true,
  taxId: true,
  status: true,
  verificationStatus: true,
  verifiedAt: true,
  isAcceptingRequests: true,
  createdAt: true,
  updatedAt: true,
  categories: { select: { id: true } },
} as const;

type PrismaProfessionalWithCategories = {
  id: string;
  userId: string;
  businessName: string | null;
  bio: string | null;
  headline: string | null;
  yearsExperience: number | null;
  hourlyRate: unknown;
  serviceRadiusKm: number | null;
  contactEmail: string | null;
  contactPhone: string | null;
  websiteUrl: string | null;
  taxId: string | null;
  status: string;
  verificationStatus: string;
  verifiedAt: Date | null;
  isAcceptingRequests: boolean;
  createdAt: Date;
  updatedAt: Date;
  categories: { id: string }[];
};

function toRecord(row: PrismaProfessionalWithCategories): ProfessionalRecord {
  return {
    id: row.id,
    userId: row.userId,
    businessName: row.businessName,
    bio: row.bio,
    headline: row.headline,
    yearsExperience: row.yearsExperience,
    // Decimal(10,2) column — converted to a plain number at the
    // repository boundary so domain/application code never has to know
    // about Prisma's Decimal type, matching how the rest of the app keeps
    // Prisma-specific types out of those layers.
    hourlyRate: row.hourlyRate === null ? null : Number(row.hourlyRate),
    serviceRadiusKm: row.serviceRadiusKm,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    websiteUrl: row.websiteUrl,
    taxId: row.taxId,
    status: row.status as ProfessionalRecord["status"],
    verificationStatus: row.verificationStatus as ProfessionalRecord["verificationStatus"],
    verifiedAt: row.verifiedAt,
    isAcceptingRequests: row.isAcceptingRequests,
    categoryIds: row.categories.map((c) => c.id),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PrismaProfessionalRepository implements ProfessionalRepository {
  async findById(id: string): Promise<ProfessionalRecord | null> {
    const row = await prisma.professionalProfile.findUnique({
      where: { id, deletedAt: null },
      select: SELECT,
    });
    return row ? toRecord(row) : null;
  }

  async findByUserId(userId: string): Promise<ProfessionalRecord | null> {
    const row = await prisma.professionalProfile.findFirst({
      where: { userId, deletedAt: null },
      select: SELECT,
    });
    return row ? toRecord(row) : null;
  }

  async create(userId: string, data: CreateProfessionalData): Promise<ProfessionalRecord> {
    const row = await prisma.professionalProfile.create({
      data: {
        userId,
        businessName: data.businessName ?? null,
        bio: data.bio ?? null,
        headline: data.headline ?? null,
        yearsExperience: data.yearsExperience ?? null,
        hourlyRate: data.hourlyRate ?? null,
        serviceRadiusKm: data.serviceRadiusKm ?? null,
        contactEmail: data.contactEmail ?? null,
        contactPhone: data.contactPhone ?? null,
        websiteUrl: data.websiteUrl ?? null,
        taxId: data.taxId ?? null,
        categories: data.categoryIds?.length
          ? { connect: data.categoryIds.map((id) => ({ id })) }
          : undefined,
      },
      select: SELECT,
    });
    return toRecord(row);
  }

  async update(id: string, data: UpdateProfessionalData): Promise<ProfessionalRecord> {
    const row = await prisma.professionalProfile.update({
      where: { id },
      data: {
        businessName: data.businessName,
        bio: data.bio,
        headline: data.headline,
        yearsExperience: data.yearsExperience,
        hourlyRate: data.hourlyRate,
        serviceRadiusKm: data.serviceRadiusKm,
        contactEmail: data.contactEmail,
        contactPhone: data.contactPhone,
        websiteUrl: data.websiteUrl,
        taxId: data.taxId,
        isAcceptingRequests: data.isAcceptingRequests,
      },
      select: SELECT,
    });
    return toRecord(row);
  }

  async updateStatus(id: string, status: ProfessionalStatusValue): Promise<void> {
    await prisma.professionalProfile.update({ where: { id }, data: { status } });
  }

  async updateCategories(id: string, categoryIds: string[]): Promise<ProfessionalRecord> {
    const row = await prisma.professionalProfile.update({
      where: { id },
      data: { categories: { set: categoryIds.map((categoryId) => ({ id: categoryId })) } },
      select: SELECT,
    });
    return toRecord(row);
  }
}
