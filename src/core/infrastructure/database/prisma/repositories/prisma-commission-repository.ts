import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  CommissionRecord,
  CommissionRepository,
  CommissionStatusValue,
  CreateCommissionData,
} from "@/domain/repositories/commission-repository";

const SELECT = {
  id: true,
  paymentId: true,
  professionalProfileId: true,
  companyProfileId: true,
  rateBps: true,
  amount: true,
  status: true,
  settledAt: true,
  createdAt: true,
} as const;

type Row = {
  id: string;
  paymentId: string;
  professionalProfileId: string | null;
  companyProfileId: string | null;
  rateBps: number;
  amount: unknown;
  status: string;
  settledAt: Date | null;
  createdAt: Date;
};

function toRecord(row: Row): CommissionRecord {
  return {
    id: row.id,
    paymentId: row.paymentId,
    professionalProfileId: row.professionalProfileId,
    companyProfileId: row.companyProfileId,
    rateBps: row.rateBps,
    amount: Number(row.amount),
    status: row.status as CommissionStatusValue,
    settledAt: row.settledAt,
    createdAt: row.createdAt,
  };
}

export class PrismaCommissionRepository implements CommissionRepository {
  async findByPaymentId(paymentId: string): Promise<CommissionRecord | null> {
    const row = await prisma.commission.findUnique({ where: { paymentId }, select: SELECT });
    return row ? toRecord(row) : null;
  }

  async create(data: CreateCommissionData): Promise<CommissionRecord> {
    // Relies on Commission.paymentId's DB-level unique constraint as the
    // authoritative "never two commissions for one payment" guard — a
    // concurrent duplicate call throws a Prisma unique-constraint error
    // (P2002) here rather than silently succeeding twice; callers (see
    // RecordCommissionForPaymentUseCase) already check findByPaymentId
    // first as the fast path, this is the race-safe backstop.
    const row = await prisma.commission.create({
      data: {
        paymentId: data.paymentId,
        professionalProfileId: data.professionalProfileId,
        companyProfileId: data.companyProfileId,
        rateBps: data.rateBps,
        amount: data.amount,
      },
      select: SELECT,
    });
    return toRecord(row);
  }

  async listForProfessional(professionalProfileId: string): Promise<CommissionRecord[]> {
    const rows = await prisma.commission.findMany({
      where: { professionalProfileId },
      select: SELECT,
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toRecord);
  }

  async listForCompany(companyProfileId: string): Promise<CommissionRecord[]> {
    const rows = await prisma.commission.findMany({
      where: { companyProfileId },
      select: SELECT,
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toRecord);
  }
}
