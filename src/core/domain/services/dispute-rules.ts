import type { JobStatusValue } from "@/domain/repositories/job-repository";

/**
 * Module 21 — Disputes & Support: pure, dependency-free business rules for
 * Dispute — same small-helper style as admin-rules.ts/review-rules.ts.
 *
 * MVP domain rules this module had to decide (no product spec existed for
 * these before this module — see docs/MODULE_21_DISPUTES_SUPPORT.md,
 * "Domain rules" for the full write-up of each decision below):
 *
 *   - Who can open a dispute: the customer or the professional/company party
 *     to the Job (enforced by CreateDisputeUseCase via resolveJobActor-style
 *     ownership resolution, not by this file).
 *   - Which Job states allow opening a dispute: IN_PROGRESS, COMPLETED, or
 *     CANCELLED — never CREATED (nothing has happened yet to dispute). See
 *     DISPUTABLE_JOB_STATUSES below.
 *   - Dispute time window after Job completion/cancellation: 30 days (see
 *     DISPUTE_WINDOW_DAYS below) — a named, adjustable constant, not a
 *     hardcoded magic number scattered across use cases.
 *   - One dispute per Job per opener, or can both customer and professional
 *     open separate disputes for the same Job: both may open independently,
 *     but the same user may not have a second concurrently-OPEN dispute on
 *     the same Job — enforced at the application level in
 *     CreateDisputeUseCase AND by a partial unique index at the DB level
 *     (see the migration's `disputes_open_per_job_per_opener_unique`).
 *   - Can a CLOSED dispute be reopened: no — explicit MVP limitation, see
 *     docs/MODULE_21_DISPUTES_SUPPORT.md, "Out of scope".
 *   - Who resolves/closes: admin only for both — no auto-close after N days
 *     in this module (that would be SLA automation, explicitly out of
 *     scope — see the module doc's "Out of scope" section).
 */

/** Job statuses from which a dispute may be opened. Deliberately excludes
 *  CREATED — a Job that hasn't started yet has nothing to dispute. */
export const DISPUTABLE_JOB_STATUSES: readonly JobStatusValue[] = ["IN_PROGRESS", "COMPLETED", "CANCELLED"];

export function isDisputableJobStatus(status: JobStatusValue): boolean {
  return DISPUTABLE_JOB_STATUSES.includes(status);
}

/** How long after a Job reaches a terminal status (COMPLETED/CANCELLED) a
 *  dispute may still be opened over it. A Job still IN_PROGRESS has no
 *  window limit (there is no "terminal timestamp" to measure from yet).
 *  Adjustable — reconsider once real dispute volume/patterns exist. */
export const DISPUTE_WINDOW_DAYS = 30;

/** Whether `referenceDate` (the Job's completedAt/cancelledAt, whichever
 *  applies) is still within the dispute window as of `now`. Jobs that are
 *  still IN_PROGRESS have no reference date to check (pass `null` — always
 *  within the window while the job is ongoing). */
export function isWithinDisputeWindow(referenceDate: Date | null, now: Date): boolean {
  if (referenceDate === null) return true;
  const deadline = new Date(referenceDate.getTime() + DISPUTE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return now.getTime() <= deadline.getTime();
}

export const MAX_TITLE_LENGTH = 150;
export const MIN_TITLE_LENGTH = 5;
export const MAX_DESCRIPTION_LENGTH = 5000;
export const MIN_DESCRIPTION_LENGTH = 20;
export const MAX_MESSAGE_LENGTH = 5000;
export const MAX_RESOLUTION_NOTE_LENGTH = 3000;
export const MAX_EVIDENCE_DESCRIPTION_LENGTH = 500;

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/** Formats a sequential per-year case/ticket number, e.g. "DSP-2026-000123"
 *  / "TCK-2026-000123". `sequence` is 1-based. See
 *  PrismaDisputeRepository.create / PrismaSupportTicketRepository.create's
 *  own doc comment for how `sequence` is derived and the known race-window
 *  limitation (best-effort count-based numbering, not a DB sequence —
 *  acceptable for a human-readable reference number that is never used as
 *  a primary key or a security boundary). */
export function formatCaseNumber(prefix: "DSP" | "TCK", year: number, sequence: number): string {
  return `${prefix}-${year}-${String(sequence).padStart(6, "0")}`;
}
