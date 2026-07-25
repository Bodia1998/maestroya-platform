import type { PlatformAnalyticsRepository } from "@/domain/repositories/analytics-repository";
import { generateBucketBoundaries, resolveTimeSeriesRange } from "@/domain/services/analytics-date-range";
import type { AnalyticsTimeSeriesPointDTO, GetAnalyticsTimeSeriesInput } from "@/application/dto/analytics.dto";

/**
 * Module 23 — Analytics: admin-only time-series of ServiceRequest creation
 * volume. Admin-only for the same reason GetPlatformAnalyticsSummaryUseCase
 * is — authorization is the calling Server Action's job, not this use
 * case's.
 *
 * Unlike the summary use case, a time series *requires* both `from` and
 * `to` (see resolveTimeSeriesRange) — an open-ended time series is exactly
 * the unbounded-array problem the module spec's performance section warns
 * about. Every bucket in `[from, to]` is present in the result, in order,
 * with `count: 0` for periods with no activity (see
 * generateBucketBoundaries's own doc comment) — a consumer never needs to
 * special-case a missing bucket.
 */
export class GetPlatformRequestsTimeSeriesUseCase {
  constructor(private readonly analytics: PlatformAnalyticsRepository) {}

  async execute(input: GetAnalyticsTimeSeriesInput): Promise<AnalyticsTimeSeriesPointDTO[]> {
    const range = resolveTimeSeriesRange(input, input.granularity);
    const sparse = await this.analytics.getServiceRequestsTimeSeries(range, input.granularity);
    const sparseByBucket = new Map(sparse.map((b) => [b.bucketStart.getTime(), b.count]));

    return generateBucketBoundaries(range.from, range.to, input.granularity).map((bucketStart) => ({
      bucketStart,
      count: sparseByBucket.get(bucketStart.getTime()) ?? 0,
    }));
  }
}
