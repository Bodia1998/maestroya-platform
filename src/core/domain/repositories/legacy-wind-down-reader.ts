import type { LegacyWindDownSnapshot } from "@/domain/services/legacy-wind-down";

/**
 * Module 166 — read-only port for the legacy wind-down inventory.
 *
 * Deliberately a single query-only method: there is no write, update, delete or "mark settled" capability anywhere on this
 * port. The returned snapshot MUST be internally consistent (read at one point in time) and cover LEGACY_QUOTE_PAYMENT
 * records only; an implementation that cannot read everything within its configured limit throws
 * LegacyWindDownScopeTooLargeError instead of returning a partial snapshot.
 */
export interface LegacyWindDownReader {
  readSnapshot(): Promise<LegacyWindDownSnapshot>;
}
