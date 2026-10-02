import { Prisma } from "@prisma/client";

import { prisma } from "@/infrastructure/database/prisma/client";
import { NotFoundError } from "@/domain/errors/domain-error";
import type { CreateLeadData, LeadRecord, LeadRepository } from "@/domain/repositories/lead-repository";
import { LeadAlreadyExistsError, assertLeadEligibleFlow, isLeadStatus, normalizeLeadMaxBuyers } from "@/domain/services/lead";
import type { TransactionFlowVersion } from "@/domain/services/transaction-flow";

/** Explicit column list. NEVER add customer/address/contact columns here —
 *  only `flowVersion` is read from the ServiceRequest. */
const SELECT = {
  id: true,
  serviceRequestId: true,
  status: true,
  maxBuyers: true,
  createdAt: true,
  updatedAt: true,
  serviceRequest: { select: { flowVersion: true } },
} as const;

type Row = {
  id: string;
  serviceRequestId: string;
  status: string;
  maxBuyers: number | null;
  createdAt: Date;
  updatedAt: Date;
  serviceRequest: { flowVersion: string };
};

function toRecord(row: Row): LeadRecord {
  if (!isLeadStatus(row.status)) throw new Error(`Unknown Lead status "${row.status}".`);
  return {
    id: row.id,
    serviceRequestId: row.serviceRequestId,
    status: row.status,
    flowVersion: row.serviceRequest.flowVersion as TransactionFlowVersion,
    maxBuyers: row.maxBuyers,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Module 123 — Prisma implementation of `LeadRepository`. `create` is the
 * ONLY write path for the `leads` table; it enforces "Lead -> LEAD_V1" by
 * reading the ServiceRequest's flowVersion in the same transaction as the
 * insert (a static contract test forbids other `lead.create` call sites).
 */
export class PrismaLeadRepository implements LeadRepository {
  async create(data: CreateLeadData): Promise<LeadRecord> {
    const maxBuyers = normalizeLeadMaxBuyers(data.maxBuyers);
    try {
      const row = await prisma.$transaction(async (tx) => {
        const request = await tx.serviceRequest.findUnique({
          where: { id: data.serviceRequestId },
          select: { flowVersion: true, deletedAt: true },
        });
        if (!request || request.deletedAt) throw new NotFoundError("ServiceRequest", data.serviceRequestId);
        assertLeadEligibleFlow(request.flowVersion);
        return tx.lead.create({
          data: { serviceRequestId: data.serviceRequestId, maxBuyers },
          select: SELECT,
        });
      });
      return toRecord(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new LeadAlreadyExistsError(data.serviceRequestId);
      }
      throw error;
    }
  }

  async findById(id: string): Promise<LeadRecord | null> {
    const row = await prisma.lead.findUnique({ where: { id }, select: SELECT });
    return row ? toRecord(row) : null;
  }

  async findByServiceRequestId(serviceRequestId: string): Promise<LeadRecord | null> {
    const row = await prisma.lead.findUnique({ where: { serviceRequestId }, select: SELECT });
    return row ? toRecord(row) : null;
  }
}
