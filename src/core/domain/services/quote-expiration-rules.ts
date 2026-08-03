import type { QuoteStatusValue } from "@/domain/repositories/quote-repository";

/**
 * Module 28 — Workflow Completion: pure, dependency-free rule for when a
 * Quote should auto-transition to EXPIRED, mirroring
 * service-request-expiration-rules.ts's shape. Only a Quote still awaiting
 * a customer decision (PENDING/SENT/VIEWED) can expire — ACCEPTED/REJECTED/
 * WITHDRAWN are already terminal and `validUntil` is never re-checked for
 * them.
 */
export const EXPIRABLE_QUOTE_STATUSES: readonly QuoteStatusValue[] = ["PENDING", "SENT", "VIEWED"];

export function isQuoteExpirable(status: QuoteStatusValue, validUntil: Date | null, now: Date): boolean {
  if (!validUntil) return false;
  if (!EXPIRABLE_QUOTE_STATUSES.includes(status)) return false;
  return validUntil.getTime() <= now.getTime();
}
