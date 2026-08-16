/**
 * Module 67 — Trust & Integrity Completion Risk Detection: pure, dependency-
 * free rule engine for "premature job completion" — the Module 66 audit
 * finding this module exists to close (see MODULE_66_IMPLEMENTATION_REPORT.md
 * §13). Same "caller fetches, this file only decides" convention as every
 * other Module 65 rule engine (see booking-abuse-detection-rules.ts,
 * payment-abuse-detection-rules.ts, identity-risk-rules.ts) — this module
 * introduces no new detection architecture, it only adds one more rule
 * engine plugged into the existing Detect*UseCase / FraudSignal / Trust &
 * Integrity pipeline.
 *
 * ## What "premature" means here
 * `ProfessionalCompletedJob` (Module 66, domain/events/professional-
 * completed-job.ts) already carries `startedAt`/`completedAt` specifically
 * "so a future subscriber can compute how long this job actually took" —
 * this file is that subscriber's pure decision logic. A Job can only reach
 * `IN_PROGRESS` (and therefore have `startedAt` set) via `StartJobUseCase`,
 * and can only be completed from `IN_PROGRESS` (see job-state.ts's
 * `isCompletableStatus`) — so `startedAt` is always present by the time
 * `CompleteJobUseCase` publishes this event in the normal flow. This file
 * still treats a missing `startedAt` as "cannot evaluate" rather than
 * assuming a default, per this module's own explicit instruction not to
 * invent behavior for missing optional data — see `detectPrematureCompletion`.
 *
 * ## The threshold — a named, centralized business rule
 * No pre-existing constant in this codebase encodes "how long must a job
 * take before completion is plausible" (the closest sibling constants —
 * `CONFIRMATION_WINDOW_HOURS` in job-completion-confirmation-rules.ts,
 * `DISPUTE_WINDOW_DAYS` in dispute-rules.ts — both measure a *reaction*
 * window, not actual work duration). This module therefore introduces
 * `MIN_REASONABLE_JOB_DURATION_MINUTES` as a new, explicit, centralized
 * domain constant (never scattered inline across use cases) rather than
 * silently reusing an unrelated existing number. The value (10 minutes) is
 * deliberately conservative: MaestroYa jobs are on-site home-service visits
 * (travel already happened before `startWork`, since `startedAt` is set once
 * the professional is on-site and working) — genuinely completing a paid
 * service engagement, however small, in under 10 minutes end-to-end is
 * implausible for the marketplace's own service categories. A real fast job
 * (e.g. a minor repair) is not penalized; this floor only catches completion
 * timestamps that could not represent real service delivery — this is a
 * *risk signal for human review*, never an automatic fraud conclusion (see
 * this module's own top-level doc comment on the Trust & Integrity boundary
 * in detect-premature-job-completion.use-case.ts).
 */

export const MIN_REASONABLE_JOB_DURATION_MINUTES = 10;

export interface PrematureCompletionInput {
  jobId: string;
  professionalProfileId: string;
  /** `null` when the Job has no recorded start time — see this file's own
   *  doc comment on why that is treated as "cannot evaluate", not flagged. */
  startedAt: Date | null;
  completedAt: Date;
}

export interface PrematureCompletionFinding {
  reason: "PREMATURE_JOB_COMPLETION";
  jobId: string;
  professionalProfileId: string;
  startedAt: Date;
  completedAt: Date;
  actualDurationMinutes: number;
  detail: string;
}

/**
 * Requirement — "Premature Job Completion" detector. Pure function: no I/O,
 * no repository access. Returns `null` (never throws) for every case that
 * should NOT be flagged, including every "missing optional timing
 * information" case — see this file's own doc comment, "safe behavior" is
 * the explicit spec requirement for that case, not a defensive afterthought.
 */
export function detectPrematureCompletion(input: PrematureCompletionInput): PrematureCompletionFinding | null {
  if (input.startedAt === null) {
    // No start time recorded — cannot compute an actual duration. Safe
    // behavior: never flag on missing data (see this file's own doc
    // comment). This should not occur in the normal CompleteJobUseCase
    // flow (see that class's own doc comment) but this rule engine never
    // assumes its caller's invariants hold.
    return null;
  }

  const durationMs = input.completedAt.getTime() - input.startedAt.getTime();
  if (durationMs < 0) {
    // Defensive only — completedAt before startedAt should never happen
    // given the Job state machine (job-state.ts), but a negative duration
    // is never evidence of prematurity; never flag on malformed input.
    return null;
  }

  const durationMinutes = durationMs / 60_000;
  if (durationMinutes >= MIN_REASONABLE_JOB_DURATION_MINUTES) {
    return null;
  }

  return {
    reason: "PREMATURE_JOB_COMPLETION",
    jobId: input.jobId,
    professionalProfileId: input.professionalProfileId,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    actualDurationMinutes: Math.round(durationMinutes * 100) / 100,
    detail:
      `Job ${input.jobId} was marked completed ${durationMinutes.toFixed(1)} minute(s) after work started ` +
      `(minimum reasonable duration: ${MIN_REASONABLE_JOB_DURATION_MINUTES} minutes). This is a risk signal for ` +
      `human review, not a conclusion of wrongdoing — see Trust & Integrity policy for how it is weighed.`,
  };
}
