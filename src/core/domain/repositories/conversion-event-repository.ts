/**
 * Module 60 — Referral & Marketing Attribution Platform: repository
 * interface for `ConversionEvent` — a read-only record of "something the
 * platform already considers a conversion happened for this attributed
 * visitor" (a registration, a booking, a completed booking, or a
 * commission having been generated). This module never computes
 * `revenueAmount` or decides *when* a conversion happened — a caller
 * (a future booking/payment/commission use case, or, for registration,
 * `LinkRegistrationAttributionUseCase`) supplies already-known data.
 *
 * `referenceId` is a plain string, not a Prisma relation — the same
 * "reference another bounded context's id without a cross-module FK
 * constraint" convention `CommissionRecord.paymentId` already establishes
 * (see commission-repository.ts's own doc comment) — because a
 * `ConversionEvent` may point at a Booking, a Payment, or a Commission
 * depending on `type`, and this module has no business depending on any
 * of those modules' schemas.
 */
export const CONVERSION_TYPE_VALUES = [
  "REGISTRATION",
  "PROFESSIONAL_REGISTRATION",
  "CLIENT_REGISTRATION",
  "BOOKING_CREATED",
  "BOOKING_COMPLETED",
  "COMMISSION_GENERATED",
] as const;
export type ConversionTypeValue = (typeof CONVERSION_TYPE_VALUES)[number];

export interface ConversionEventRecord {
  id: string;
  attributionId: string;
  type: ConversionTypeValue;
  occurredAt: Date;
  referenceId: string | null;
  revenueAmount: number | null;
  createdAt: Date;
}

export interface RecordConversionEventData {
  attributionId: string;
  type: ConversionTypeValue;
  occurredAt: Date;
  referenceId?: string | null;
  revenueAmount?: number | null;
}

export interface ConversionEventRepository {
  create(data: RecordConversionEventData): Promise<ConversionEventRecord>;
  listByAttributionId(attributionId: string): Promise<ConversionEventRecord[]>;
  countByType(type: ConversionTypeValue): Promise<number>;
  sumRevenueByType(type: ConversionTypeValue): Promise<number>;
  /**
   * Module 96 — Referral & Affiliate Production Wiring: idempotency
   * lookup for a conversion tied to an already-known external reference
   * (e.g. a Module 22 `Commission.id` for a `COMMISSION_GENERATED`
   * conversion) — a caller MUST check this before `create` to stay safe
   * under a duplicate/redelivered domain event, backed by the
   * `(type, referenceId)` unique constraint at the database level (see
   * schema.prisma's own doc comment on `ConversionEvent`), never only an
   * application-level pre-check.
   */
  findByReferenceId(type: ConversionTypeValue, referenceId: string): Promise<ConversionEventRecord | null>;
}
