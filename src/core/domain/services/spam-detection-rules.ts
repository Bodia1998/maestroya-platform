/**
 * Module 65 — Trust & Integrity System: spam-detection rule engine. Same
 * "pure predicate over caller-supplied counts" convention as every other
 * Module 65 rule engine — counts/windows are gathered by the calling use
 * case (typically from `ServiceRequestRepository`/`QuoteRepository`/
 * `MessageRepository`), never queried here.
 *
 * Single source of truth boundary with Module 24 (Security & Anti-Abuse,
 * `domain/services/spam-detection.ts`): that file owns every
 * content/timing-level spam primitive — "is this candidate text a
 * duplicate of recent content" (`isDuplicateContent`, fingerprint-based)
 * and "is this action happening faster than the configured minimum
 * interval" (`isBelowMinimumInterval`). A caller that needs to compute
 * this file's `duplicateSubmissionsInWindow` (or any other raw
 * content/timestamp comparison feeding the counts below) MUST do so via
 * those Module 24 primitives — never by re-implementing fingerprinting or
 * interval math locally, which is exactly the kind of duplicated spam
 * logic this refactor removes. This file's own job starts one level up:
 * turning already-aggregated counts into DUPLICATE_REQUESTS/
 * MASS_MESSAGING/REPEATED_QUOTES/EXCESSIVE_ACTIVITY findings, a policy
 * concern (thresholds, escalation) that has no Module 24 equivalent and
 * belongs here, not there.
 */

export interface SpamActivityInput {
  userId: string;
  /** Identical (or near-identical, normalized) ServiceRequest/Quote/Message
   *  bodies submitted within the detection window. */
  duplicateSubmissionsInWindow: number;
  /** Distinct recipients messaged with the same/similar content within the
   *  window — the "mass messaging" signal. */
  distinctRecipientsSameMessageInWindow: number;
  /** Quotes re-submitted (edited and resent) an unusual number of times for
   *  the same ServiceRequest — the "repeated quotes" signal. */
  repeatedQuotesForSameRequest: number;
  /** Total actions (any kind) within the window — "excessive activity"
   *  independent of duplication. */
  totalActionsInWindow: number;
}

export const DUPLICATE_SUBMISSION_THRESHOLD = 3;
export const MASS_MESSAGING_RECIPIENT_THRESHOLD = 10;
export const REPEATED_QUOTE_THRESHOLD = 4;
export const EXCESSIVE_ACTIVITY_THRESHOLD = 50;

export interface SpamFinding {
  reason: "DUPLICATE_REQUESTS" | "MASS_MESSAGING" | "REPEATED_QUOTES" | "EXCESSIVE_ACTIVITY";
  userId: string;
  detail: string;
}

export function detectSpamActivity(input: SpamActivityInput): SpamFinding[] {
  const findings: SpamFinding[] = [];

  if (input.duplicateSubmissionsInWindow >= DUPLICATE_SUBMISSION_THRESHOLD) {
    findings.push({
      reason: "DUPLICATE_REQUESTS",
      userId: input.userId,
      detail: `${input.duplicateSubmissionsInWindow} near-identical submissions within the detection window (threshold ${DUPLICATE_SUBMISSION_THRESHOLD}).`,
    });
  }

  if (input.distinctRecipientsSameMessageInWindow >= MASS_MESSAGING_RECIPIENT_THRESHOLD) {
    findings.push({
      reason: "MASS_MESSAGING",
      userId: input.userId,
      detail: `The same (or near-identical) message sent to ${input.distinctRecipientsSameMessageInWindow} distinct recipients (threshold ${MASS_MESSAGING_RECIPIENT_THRESHOLD}).`,
    });
  }

  if (input.repeatedQuotesForSameRequest >= REPEATED_QUOTE_THRESHOLD) {
    findings.push({
      reason: "REPEATED_QUOTES",
      userId: input.userId,
      detail: `${input.repeatedQuotesForSameRequest} quote resubmissions for the same ServiceRequest (threshold ${REPEATED_QUOTE_THRESHOLD}).`,
    });
  }

  if (input.totalActionsInWindow >= EXCESSIVE_ACTIVITY_THRESHOLD) {
    findings.push({
      reason: "EXCESSIVE_ACTIVITY",
      userId: input.userId,
      detail: `${input.totalActionsInWindow} total actions within the detection window (threshold ${EXCESSIVE_ACTIVITY_THRESHOLD}).`,
    });
  }

  return findings;
}
