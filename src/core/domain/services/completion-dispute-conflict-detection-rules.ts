/**
 * Module 67 — Trust & Integrity Completion Risk Detection: pure,
 * dependency-free rule engine for "job completion / dispute conflict" — the
 * second half of the Module 66 audit finding this module closes (see
 * MODULE_66_IMPLEMENTATION_REPORT.md §13). Same "caller fetches, this file
 * only decides" convention as premature-completion-detection-rules.ts and
 * every other Module 65 rule engine.
 *
 * ## The two scenarios this file actually detects
 * The module brief lists five illustrative scenarios; two of them are
 * genuinely distinct *timing* facts this codebase's existing domain events
 * can observe without inventing new data collection, and this file
 * implements exactly those two (see each function's own doc comment for
 * which of the five scenarios it covers). The other three (scenario 4,
 * "repeated completion -> dispute patterns", and the general notion that
 * "a legitimate customer dispute is normal platform behavior" — see this
 * module's own top-level doc comment on why neither of these two findings
 * treats a dispute as automatically malicious) are addressed by:
 *   - Scenario 4 (repeated pattern): deliberately NOT wired to a live
 *     aggregate query in this pass — see this module's implementation
 *     report, "Known Limitations", for why (no existing repository method
 *     computes "professional's dispute rate following their own
 *     completions", and adding one is a materially larger, cross-module
 *     change than this module's own scope). The shape it WOULD take is a
 *     natural extension of `detectCompletionDuringActiveDispute`'s finding,
 *     not a new detector.
 *   - Scenario 5 ("completion occurs while the job is already in a
 *     dispute-related state") is exactly what `detectCompletionDuringActiveDispute`
 *     covers below — a Job has no separate "dispute-related status" of its
 *     own (see job-state.ts), so "dispute-related state" here means "an
 *     open Dispute exists on the Job", read directly from DisputeRepository.
 */

export const DISPUTE_AFTER_COMPLETION_SUSPICIOUS_WINDOW_MINUTES = 15;

export type CompletionDisputeConflictReason =
  | "DISPUTE_IMMEDIATELY_AFTER_COMPLETION"
  | "COMPLETION_DURING_ACTIVE_DISPUTE";

export interface CompletionDisputeConflictFinding {
  reason: CompletionDisputeConflictReason;
  jobId: string;
  disputeId: string;
  /** `null` for a company-owned Job — see this file's own doc comment on
   *  why company jobs are out of scope for the professional-attributed
   *  finding below, mirroring Module 66's own documented company-job
   *  limitation (EvaluatePaymentReleaseUseCase's doc comment). */
  professionalProfileId: string | null;
  detail: string;
}

export interface DisputeAfterCompletionInput {
  jobId: string;
  disputeId: string;
  /** The user who opened the dispute — recorded as the finding's nominal
   *  subject by the calling use case, WITHOUT implying fault: see
   *  detect-job-completion-dispute-conflict.use-case.ts's own doc comment,
   *  which follows the exact same "case subject is not an accusation"
   *  convention `ProcessJobCompletionConfirmationsUseCase` already
   *  established for `JOB_COMPLETION_CONFIRMATION_TIMEOUT`. */
  raisedByUserId: string;
  professionalProfileId: string | null;
  jobCompletedAt: Date;
  disputeCreatedAt: Date;
}

/**
 * Scenarios 1 and 3 — "Professional completes job. Customer immediately
 * opens a dispute." / "Completion and dispute occur within an unusually
 * short interval." Deliberately reason-agnostic about which party raised
 * the dispute (see `DisputeAfterCompletionInput.raisedByUserId`'s own doc
 * comment) — a fast dispute is a timing anomaly worth a human look, not by
 * itself evidence either party acted in bad faith (see this module's
 * top-level doc comment, "a legitimate customer dispute is normal platform
 * behavior").
 */
export function detectDisputeShortlyAfterCompletion(
  input: DisputeAfterCompletionInput,
): CompletionDisputeConflictFinding | null {
  const minutesAfter = (input.disputeCreatedAt.getTime() - input.jobCompletedAt.getTime()) / 60_000;

  if (minutesAfter < 0) {
    // The dispute predates completion — not this scenario at all (see
    // detectCompletionDuringActiveDispute below for that case).
    return null;
  }

  if (minutesAfter >= DISPUTE_AFTER_COMPLETION_SUSPICIOUS_WINDOW_MINUTES) {
    return null;
  }

  return {
    reason: "DISPUTE_IMMEDIATELY_AFTER_COMPLETION",
    jobId: input.jobId,
    disputeId: input.disputeId,
    professionalProfileId: input.professionalProfileId,
    detail:
      `Dispute ${input.disputeId} was opened ${minutesAfter.toFixed(1)} minute(s) after job ${input.jobId} was ` +
      `marked completed (suspicious-window threshold: ${DISPUTE_AFTER_COMPLETION_SUSPICIOUS_WINDOW_MINUTES} minutes). ` +
      `This is a timing anomaly for human review, not a conclusion that either party acted in bad faith.`,
  };
}

export interface CompletionDuringActiveDisputeInput {
  jobId: string;
  professionalProfileId: string | null;
  completedByUserId: string;
  completedAt: Date;
  /** Every Dispute id on this Job whose status was still non-CLOSED at the
   *  instant of completion — the calling use case gathers this from
   *  `DisputeRepository.listByJobId`, mirroring
   *  `EvaluatePaymentReleaseUseCase`'s own `hasBlockingDispute` computation
   *  (payment-release-decision.ts) so this detector observes the exact same
   *  "open dispute" fact Module 66's payment-release gate already uses —
   *  never a second, competing definition of "disputed". */
  openDisputeIds: readonly string[];
}

/**
 * Scenarios 2 and 5 — "Dispute already exists. Professional attempts/
 * completes the job afterward." / "Completion occurs while the job is
 * already in a dispute-related state." Unlike
 * `detectDisputeShortlyAfterCompletion` above, this scenario IS attributed
 * to a specific actor — whoever completed the Job knowingly (or should have
 * known, since `EvaluatePaymentReleaseUseCase`/`hasBlockingDispute` already
 * makes an open dispute visible platform-wide) did so while a dispute was
 * already open on it, which is a stronger signal than a dispute's mere
 * timing — see detect-job-completion-dispute-conflict.use-case.ts's own
 * doc comment for how this finding is scored differently from the
 * ambiguous-fault scenario above.
 */
export function detectCompletionDuringActiveDispute(
  input: CompletionDuringActiveDisputeInput,
): CompletionDisputeConflictFinding | null {
  if (input.openDisputeIds.length === 0) {
    return null;
  }

  // Non-null: guarded by the length check above — noUncheckedIndexedAccess
  // still types a bare index access as possibly undefined.
  const firstOpenDisputeId = input.openDisputeIds[0]!;

  return {
    reason: "COMPLETION_DURING_ACTIVE_DISPUTE",
    jobId: input.jobId,
    disputeId: firstOpenDisputeId,
    professionalProfileId: input.professionalProfileId,
    detail:
      `Job ${input.jobId} was marked completed while ${input.openDisputeIds.length} dispute(s) ` +
      `(${input.openDisputeIds.join(", ")}) were still open on it.`,
  };
}
