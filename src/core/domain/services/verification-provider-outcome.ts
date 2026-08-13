import {
  canTransition,
  type ProfessionalVerificationStatusValue,
} from "@/domain/services/professional-verification-rules";

/**
 * Module 59 — Professional Verification (Persona).
 *
 * The normalized, provider-agnostic vocabulary a `VerificationProvider`
 * (application/ports/verification-provider.ts) implementation maps its own
 * raw status strings onto (Persona's inquiry `status` field —
 * `created`/`pending`/`completed`/`failed`/`needs_review`/`expired`/
 * `declined` — for the one provider this module ships; a future second
 * provider maps its own vocabulary onto the exact same
 * `ProviderVerificationOutcome` values, never a Persona-specific one).
 *
 * This is intentionally a *different, smaller* enum from
 * `ProfessionalVerificationStatusValue` — it describes what the *provider*
 * is reporting, not what the *case* is allowed to transition to. The
 * mapping in `mapProviderOutcomeToCaseStatus` below is the single place a
 * provider outcome is translated into a case status, and
 * `RefreshVerificationStatusUseCase` still validates the result through
 * `canTransition` before ever writing it — an outcome the provider reports
 * that would produce an illegal transition (e.g. the provider somehow
 * reports IN_PROGRESS for a case already APPROVED) is rejected, never
 * silently applied.
 */
export const PROVIDER_VERIFICATION_OUTCOME_VALUES = [
  "NOT_STARTED",
  "PENDING",
  "IN_PROGRESS",
  "NEEDS_REVIEW",
  "VERIFIED",
  "REJECTED",
  "EXPIRED",
  "ERROR",
] as const;
export type ProviderVerificationOutcome = (typeof PROVIDER_VERIFICATION_OUTCOME_VALUES)[number];

/**
 * The case status a given provider outcome maps onto, if applied. Returns
 * `null` for outcomes that never change the case's own status by
 * themselves:
 *  - `NOT_STARTED` — no provider verification exists yet; nothing to sync.
 *  - `PENDING`/`IN_PROGRESS` — the inquiry is running; the case is already
 *    PENDING/UNDER_REVIEW from `StartProfessionalVerificationUseCase`, and
 *    re-observing "still running" is a no-op sync, not a transition.
 *  - `ERROR` — a transient provider/network failure (see
 *    `VerificationProviderError`), never itself a verdict on the
 *    professional; the caller retries, it never writes a status.
 *
 * `NEEDS_REVIEW` maps to `UNDER_REVIEW` (Persona flagged the inquiry for a
 * human to look at) rather than `RESUBMISSION_REQUIRED` — the professional
 * hasn't been asked to do anything yet; an admin has to look first (see
 * `canApprove`/`canReject`/`canRequestResubmission`, all valid from
 * UNDER_REVIEW).
 */
export function mapProviderOutcomeToCaseStatus(
  outcome: ProviderVerificationOutcome,
): ProfessionalVerificationStatusValue | null {
  switch (outcome) {
    case "NOT_STARTED":
    case "PENDING":
    case "IN_PROGRESS":
    case "ERROR":
      return null;
    case "NEEDS_REVIEW":
      return "UNDER_REVIEW";
    case "VERIFIED":
      return "APPROVED";
    case "REJECTED":
      return "REJECTED";
    case "EXPIRED":
      return "EXPIRED";
  }
}

/**
 * Applies `canTransition` on top of `mapProviderOutcomeToCaseStatus` — the
 * single check `RefreshVerificationStatusUseCase`/`SynchronizeVerificationUseCase`
 * call before writing a provider-observed outcome as the case's new
 * status. Returns `null` for "no status change should be applied" (either
 * the outcome doesn't map to a status at all, the mapped status is the
 * same as `currentStatus` — nothing changed — or the transition isn't
 * legal from `currentStatus`, which the use case treats as "ignore this
 * observation" rather than a hard failure, since a provider can report a
 * stale outcome after an admin has already independently decided the
 * case).
 */
export function resolveProviderStatusTransition(
  currentStatus: ProfessionalVerificationStatusValue,
  outcome: ProviderVerificationOutcome,
): ProfessionalVerificationStatusValue | null {
  const target = mapProviderOutcomeToCaseStatus(outcome);
  if (!target || target === currentStatus) return null;
  return canTransition(currentStatus, target) ? target : null;
}
