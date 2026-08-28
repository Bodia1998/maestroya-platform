import { prisma } from "@/infrastructure/database/prisma/client";
import { NotFoundError } from "@/domain/errors/domain-error";
import type {
  GrantSelfBillingAuthorizationData,
  SelfBillingAuthorizationRecord,
  SelfBillingAuthorizationRepository,
  SelfBillingAuthorizationStatusValue,
} from "@/domain/repositories/self-billing-authorization-repository";

/**
 * Module 79 — Invoicing & Credit Notes.
 *
 * ## Why raw SQL, not `prisma.selfBillingAuthorization.*`
 * Same documented, pre-existing sandbox constraint
 * `PrismaPayoutRepository`/`PrismaExternalWebhookEventRepository` already
 * record on themselves: `prisma generate` needs to fetch a
 * platform-specific query-engine binary from `binaries.prisma.sh`, which
 * returns `403 Forbidden` in this environment (confirmed directly against
 * this exact schema change, not something this module's own schema
 * content could ever cause or fix) — so the generated `PrismaClient`
 * type here cannot be regenerated to know about this migration's new
 * tables. Written against `prisma.$queryRawUnsafe`/`$executeRawUnsafe`
 * with every value bound as a parameter (never string-concatenated), so
 * there is no SQL-injection surface despite the raw query. Once
 * `prisma generate` can run against this schema in a real deployment,
 * this class can be rewritten against `prisma.selfBillingAuthorization.*`
 * with identical behavior.
 */

const SELECT_COLUMNS = `
  "id", "professionalProfileId", "companyProfileId", "status",
  "agreementVersion", "acceptedByUserId", "acceptedAt",
  "acceptanceIpAddress", "acceptanceUserAgent", "revokedAt",
  "revokedByUserId", "createdAt", "updatedAt"
`;

interface Row {
  id: string;
  professionalProfileId: string | null;
  companyProfileId: string | null;
  status: string;
  agreementVersion: string;
  acceptedByUserId: string;
  acceptedAt: Date;
  acceptanceIpAddress: string | null;
  acceptanceUserAgent: string | null;
  revokedAt: Date | null;
  revokedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toRecord(row: Row): SelfBillingAuthorizationRecord {
  return {
    id: row.id,
    professionalProfileId: row.professionalProfileId,
    companyProfileId: row.companyProfileId,
    status: row.status as SelfBillingAuthorizationStatusValue,
    agreementVersion: row.agreementVersion,
    acceptedByUserId: row.acceptedByUserId,
    acceptedAt: row.acceptedAt,
    acceptanceIpAddress: row.acceptanceIpAddress,
    acceptanceUserAgent: row.acceptanceUserAgent,
    revokedAt: row.revokedAt,
    revokedByUserId: row.revokedByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PrismaSelfBillingAuthorizationRepository implements SelfBillingAuthorizationRepository {
  async findActiveForProfessional(professionalProfileId: string): Promise<SelfBillingAuthorizationRecord | null> {
    const rows = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT ${SELECT_COLUMNS} FROM "self_billing_authorizations"
       WHERE "professionalProfileId" = $1::uuid AND "status" = 'ACTIVE'
       LIMIT 1`,
      professionalProfileId,
    );
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async findActiveForCompany(companyProfileId: string): Promise<SelfBillingAuthorizationRecord | null> {
    const rows = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT ${SELECT_COLUMNS} FROM "self_billing_authorizations"
       WHERE "companyProfileId" = $1::uuid AND "status" = 'ACTIVE'
       LIMIT 1`,
      companyProfileId,
    );
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async grant(data: GrantSelfBillingAuthorizationData): Promise<SelfBillingAuthorizationRecord> {
    const professionalProfileId = data.professionalProfileId ?? null;
    const companyProfileId = data.companyProfileId ?? null;

    return prisma.$transaction(async (tx) => {
      const existing = professionalProfileId
        ? await tx.$queryRawUnsafe<Row[]>(
            `SELECT ${SELECT_COLUMNS} FROM "self_billing_authorizations" WHERE "professionalProfileId" = $1::uuid AND "status" = 'ACTIVE' LIMIT 1`,
            professionalProfileId,
          )
        : await tx.$queryRawUnsafe<Row[]>(
            `SELECT ${SELECT_COLUMNS} FROM "self_billing_authorizations" WHERE "companyProfileId" = $1::uuid AND "status" = 'ACTIVE' LIMIT 1`,
            companyProfileId,
          );

      const existingRow = existing[0];
      if (existingRow && existingRow.agreementVersion === data.agreementVersion) {
        // Idempotent: an identical ACTIVE authorization already exists —
        // see this method's own doc comment.
        return toRecord(existingRow);
      }
      if (existingRow) {
        // Revoke the prior ACTIVE row (never delete/mutate its own
        // history) before inserting the new one, keeping the partial
        // unique index on ("professionalProfileId"/"companyProfileId")
        // WHERE status = 'ACTIVE' satisfied at all times.
        await tx.$executeRawUnsafe(
          `UPDATE "self_billing_authorizations" SET "status" = 'REVOKED', "revokedAt" = now(), "revokedByUserId" = $2::uuid, "updatedAt" = now() WHERE "id" = $1::uuid`,
          existingRow.id,
          data.acceptedByUserId,
        );
      }

      const inserted = await tx.$queryRawUnsafe<Row[]>(
        `INSERT INTO "self_billing_authorizations" (
           "id", "professionalProfileId", "companyProfileId", "status", "agreementVersion",
           "acceptedByUserId", "acceptedAt", "acceptanceIpAddress", "acceptanceUserAgent",
           "createdAt", "updatedAt"
         )
         VALUES (gen_random_uuid(), $1::uuid, $2::uuid, 'ACTIVE', $3, $4::uuid, $5, $6, $7, now(), now())
         RETURNING ${SELECT_COLUMNS}`,
        professionalProfileId,
        companyProfileId,
        data.agreementVersion,
        data.acceptedByUserId,
        data.acceptedAt,
        data.acceptanceIpAddress ?? null,
        data.acceptanceUserAgent ?? null,
      );

      return toRecord(inserted[0]!);
    });
  }

  async revoke(id: string, revokedByUserId: string, revokedAt: Date): Promise<SelfBillingAuthorizationRecord> {
    const rows = await prisma.$queryRawUnsafe<Row[]>(
      `UPDATE "self_billing_authorizations"
       SET "status" = 'REVOKED', "revokedAt" = $2, "revokedByUserId" = $3::uuid, "updatedAt" = now()
       WHERE "id" = $1::uuid AND "status" = 'ACTIVE'
       RETURNING ${SELECT_COLUMNS}`,
      id,
      revokedAt,
      revokedByUserId,
    );
    if (rows[0]) return toRecord(rows[0]);

    const existing = await prisma.$queryRawUnsafe<Row[]>(`SELECT ${SELECT_COLUMNS} FROM "self_billing_authorizations" WHERE "id" = $1::uuid`, id);
    if (!existing[0]) {
      throw new NotFoundError("SelfBillingAuthorization", id);
    }
    // Already REVOKED — idempotent no-op, same convention as
    // ConsentRepository.withdraw.
    return toRecord(existing[0]);
  }
}
