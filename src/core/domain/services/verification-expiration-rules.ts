/**
 * Module 28 — Workflow Completion: pure, dependency-free rule for when an
 * APPROVED verification case (professional or company) should auto-
 * transition to EXPIRED. Shared between ProfessionalVerification and
 * CompanyVerification because both aggregates use the identical rule —
 * "APPROVED past `expiresAt`" — even though their status enums
 * (ProfessionalVerificationStatusValue / VerificationCaseStatusValue) are
 * distinct Prisma enums with identical value sets (see
 * professional-verification-rules.ts's TRANSITIONS: APPROVED -> [EXPIRED]
 * is already the only allowed exit from APPROVED for both, so this
 * predicate does not introduce a new transition, only automates firing an
 * already-modeled one).
 *
 * Typed as `status: string` rather than either enum specifically so this
 * one function serves both aggregates without an artificial union type —
 * the only status this predicate cares about is the literal "APPROVED".
 */
export function isVerificationExpirable(status: string, expiresAt: Date | null, now: Date): boolean {
  if (!expiresAt) return false;
  if (status !== "APPROVED") return false;
  return expiresAt.getTime() <= now.getTime();
}
