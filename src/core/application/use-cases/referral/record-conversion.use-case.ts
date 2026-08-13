import { NotFoundError } from "@/domain/errors/domain-error";
import type { ConversionEventRecord, ConversionEventRepository, ConversionTypeValue } from "@/domain/repositories/conversion-event-repository";
import type { MarketingAttributionRepository } from "@/domain/repositories/marketing-attribution-repository";

/**
 * Module 60 — Referral & Marketing Attribution Platform: records a single
 * `ConversionEvent` against the visitor's existing `MarketingAttribution`.
 * Deliberately read-only with respect to whatever the conversion is
 * *about* — `revenueAmount`/`referenceId` are supplied by the caller
 * (a booking/payment/commission use case, in a future module — see
 * docs/MODULE_60's "Remaining Limitations"), this use case never computes
 * or looks either up itself.
 *
 * Requires an existing attribution row: a conversion is only meaningful
 * relative to *some* tracked visitor, so a caller that has no
 * `visitorId`/attribution to attach it to has nothing for this module to
 * record (unlike `RegistrationAttributionLinker.linkRegistration`, which
 * is explicitly best-effort because it runs inline in registration — this
 * use case is called deliberately by a caller that already knows it wants
 * a conversion recorded).
 */
export interface RecordConversionInput {
  visitorId: string;
  type: ConversionTypeValue;
  occurredAt?: Date;
  referenceId?: string | null;
  revenueAmount?: number | null;
}

export class RecordConversionUseCase {
  constructor(
    private readonly conversions: ConversionEventRepository,
    private readonly attributions: MarketingAttributionRepository,
  ) {}

  async execute(input: RecordConversionInput): Promise<ConversionEventRecord> {
    const attribution = await this.attributions.findByVisitorId(input.visitorId);
    if (!attribution) {
      throw new NotFoundError("MarketingAttribution", input.visitorId);
    }

    return this.conversions.create({
      attributionId: attribution.id,
      type: input.type,
      occurredAt: input.occurredAt ?? new Date(),
      referenceId: input.referenceId ?? null,
      revenueAmount: input.revenueAmount ?? null,
    });
  }
}
