import type {
  AccountRestrictionRecord,
  AccountRestrictionState,
} from "@/domain/repositories/account-restriction-repository";

/**
 * Security & Anti-Abuse module (Module 24): pure rules for
 * AccountRestriction, mirroring the small-domain-service style of
 * job-state.ts/quote-state.ts.
 */

/** Most-to-least severe. TEMPORARILY_BLOCKED stops the action outright;
 *  THROTTLED and FLAGGED are informational/soft states a caller may choose
 *  to react to differently (see AntiAbuseService.assertNotBlocked, which
 *  only ever hard-blocks on TEMPORARILY_BLOCKED). */
const SEVERITY_ORDER: readonly AccountRestrictionState[] = [
  "TEMPORARILY_BLOCKED",
  "THROTTLED",
  "FLAGGED",
];

export function isRestrictionActive(restriction: Pick<AccountRestrictionRecord, "liftedAt" | "expiresAt">, now: Date): boolean {
  if (restriction.liftedAt) return false;
  if (restriction.expiresAt && restriction.expiresAt.getTime() <= now.getTime()) return false;
  return true;
}

/** Picks the single most severe *active* restriction from a list — used by
 *  Prisma implementations that fetch multiple candidate rows and need one
 *  deterministic "current state" answer. */
export function mostSevereActiveRestriction(
  restrictions: AccountRestrictionRecord[],
  now: Date,
): AccountRestrictionRecord | null {
  const active = restrictions.filter((r) => isRestrictionActive(r, now));
  if (active.length === 0) return null;

  return active.reduce((mostSevere, candidate) => {
    const mostSevereRank = SEVERITY_ORDER.indexOf(mostSevere.state);
    const candidateRank = SEVERITY_ORDER.indexOf(candidate.state);
    return candidateRank < mostSevereRank ? candidate : mostSevere;
  });
}

export function isHardBlocked(restriction: AccountRestrictionRecord | null): boolean {
  return restriction?.state === "TEMPORARILY_BLOCKED";
}
