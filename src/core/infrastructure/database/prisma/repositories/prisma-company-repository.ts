import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  CompanyRecord,
  CompanyRepository,
  CreateCompanyData,
  UpdateCompanyData,
} from "@/domain/repositories/company-repository";
import type { CompanyStatusValue } from "@/domain/services/company-rules";

/** Module 18 — Company Professional: Prisma implementation of
 *  CompanyRepository, backed by the existing `company_profiles` table
 *  (Phase 1) plus this module's additive columns. Same "narrow SELECT +
 *  toRecord mapper" convention as PrismaProfessionalRepository. */

const SELECT = {
  id: true,
  ownerUserId: true,
  legalName: true,
  tradeName: true,
  taxId: true,
  description: true,
  logoUrl: true,
  websiteUrl: true,
  slug: true,
  contactEmail: true,
  contactPhone: true,
  addressLine: true,
  city: true,
  province: true,
  postalCode: true,
  country: true,
  latitude: true,
  longitude: true,
  status: true,
  suspendedAt: true,
  isVerified: true,
  verifiedAt: true,
  stripeConnectAccountId: true,
  averageRating: true,
  reviewCount: true,
  isAcceptingRequests: true,
  createdAt: true,
  updatedAt: true,
  categories: { select: { id: true } },
} as const;

type Row = {
  id: string;
  ownerUserId: string;
  legalName: string;
  tradeName: string | null;
  taxId: string;
  description: string | null;
  logoUrl: string | null;
  websiteUrl: string | null;
  slug: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  addressLine: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  status: string;
  suspendedAt: Date | null;
  isVerified: boolean;
  verifiedAt: Date | null;
  stripeConnectAccountId: string | null;
  averageRating: unknown;
  reviewCount: number;
  isAcceptingRequests: boolean;
  createdAt: Date;
  updatedAt: Date;
  categories: { id: string }[];
};

function toRecord(row: Row): CompanyRecord {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    legalName: row.legalName,
    tradeName: row.tradeName,
    taxId: row.taxId,
    description: row.description,
    logoUrl: row.logoUrl,
    websiteUrl: row.websiteUrl,
    slug: row.slug,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    addressLine: row.addressLine,
    city: row.city,
    province: row.province,
    postalCode: row.postalCode,
    country: row.country,
    latitude: row.latitude,
    longitude: row.longitude,
    status: row.status as CompanyStatusValue,
    suspendedAt: row.suspendedAt,
    isVerified: row.isVerified,
    verifiedAt: row.verifiedAt,
    stripeConnectAccountId: row.stripeConnectAccountId,
    averageRating: row.averageRating === null ? null : Number(row.averageRating),
    reviewCount: row.reviewCount,
    isAcceptingRequests: row.isAcceptingRequests,
    categoryIds: row.categories.map((c) => c.id),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PrismaCompanyRepository implements CompanyRepository {
  async findById(id: string): Promise<CompanyRecord | null> {
    const row = await prisma.companyProfile.findUnique({ where: { id, deletedAt: null }, select: SELECT });
    return row ? toRecord(row) : null;
  }

  async findByOwnerUserId(ownerUserId: string): Promise<CompanyRecord | null> {
    const row = await prisma.companyProfile.findFirst({
      where: { ownerUserId, deletedAt: null },
      orderBy: { createdAt: "asc" },
      select: SELECT,
    });
    return row ? toRecord(row) : null;
  }

  async findBySlug(slug: string): Promise<CompanyRecord | null> {
    const row = await prisma.companyProfile.findFirst({ where: { slug, deletedAt: null }, select: SELECT });
    return row ? toRecord(row) : null;
  }

  async findByTaxId(taxId: string): Promise<CompanyRecord | null> {
    const row = await prisma.companyProfile.findFirst({ where: { taxId }, select: SELECT });
    return row ? toRecord(row) : null;
  }

  async existsBySlug(slug: string): Promise<boolean> {
    const count = await prisma.companyProfile.count({ where: { slug } });
    return count > 0;
  }

  async create(ownerUserId: string, data: CreateCompanyData): Promise<CompanyRecord> {
    const row = await prisma.companyProfile.create({
      data: {
        ownerUserId,
        legalName: data.legalName,
        tradeName: data.tradeName ?? null,
        taxId: data.taxId,
        description: data.description ?? null,
        logoUrl: data.logoUrl ?? null,
        websiteUrl: data.websiteUrl ?? null,
        slug: data.slug,
        contactEmail: data.contactEmail ?? null,
        contactPhone: data.contactPhone ?? null,
        addressLine: data.addressLine ?? null,
        city: data.city ?? null,
        province: data.province ?? null,
        postalCode: data.postalCode ?? null,
        country: data.country ?? null,
        latitude: data.latitude ?? null,
        longitude: data.longitude ?? null,
        categories: data.categoryIds?.length ? { connect: data.categoryIds.map((id) => ({ id })) } : undefined,
      },
      select: SELECT,
    });
    return toRecord(row);
  }

  async update(id: string, data: UpdateCompanyData): Promise<CompanyRecord> {
    const row = await prisma.companyProfile.update({
      where: { id },
      data: {
        legalName: data.legalName,
        tradeName: data.tradeName,
        description: data.description,
        logoUrl: data.logoUrl,
        websiteUrl: data.websiteUrl,
        contactEmail: data.contactEmail,
        contactPhone: data.contactPhone,
        addressLine: data.addressLine,
        city: data.city,
        province: data.province,
        postalCode: data.postalCode,
        country: data.country,
        latitude: data.latitude,
        longitude: data.longitude,
        isAcceptingRequests: data.isAcceptingRequests,
      },
      select: SELECT,
    });
    return toRecord(row);
  }

  async updateStatus(id: string, status: CompanyStatusValue, suspendedAt: Date | null): Promise<void> {
    await prisma.companyProfile.update({ where: { id }, data: { status, suspendedAt } });
  }

  async updateCategories(id: string, categoryIds: string[]): Promise<CompanyRecord> {
    const row = await prisma.companyProfile.update({
      where: { id },
      data: { categories: { set: categoryIds.map((categoryId) => ({ id: categoryId })) } },
      select: SELECT,
    });
    return toRecord(row);
  }

  async updateOwner(id: string, newOwnerUserId: string): Promise<void> {
    await prisma.companyProfile.update({ where: { id }, data: { ownerUserId: newOwnerUserId } });
  }
}
