import type { LegacyArchiveOptions, LegacyArchiveSnapshot } from "@/domain/services/legacy-archive";

/**
 * Module 167 — read-only port for the legacy archive export.
 *
 * Deliberately a single query-only method: there is no write, update, delete or "mark exported" capability anywhere on this port.
 * The returned snapshot MUST be internally consistent (read at one point in time), cover LEGACY_QUOTE_PAYMENT records only, and
 * select only the fields the spec allows for `options`. An implementation that cannot read everything within its configured
 * limit throws instead of returning a partial snapshot.
 */
export interface LegacyArchiveReader {
  readSnapshot(options: LegacyArchiveOptions): Promise<LegacyArchiveSnapshot>;
}
