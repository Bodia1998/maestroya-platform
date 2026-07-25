import type { SupportTicketStatusValue } from "@/domain/repositories/support-ticket-repository";

/**
 * Module 21 — Disputes & Support: SupportTicket status-transition rules —
 * same style/role as dispute-state.ts, kept as its own small file rather
 * than merged with dispute-state.ts because the two lifecycles, while
 * shaped similarly, are independent state machines over independent enums
 * (SupportTicketStatus vs DisputeStatus) with no shared transition logic to
 * factor out.
 *
 * Lifecycle:
 *
 *   OPEN -> IN_PROGRESS
 *   IN_PROGRESS -> WAITING_FOR_USER
 *   WAITING_FOR_USER -> IN_PROGRESS   (user responded)
 *   IN_PROGRESS -> RESOLVED
 *   WAITING_FOR_USER -> RESOLVED
 *   OPEN -> RESOLVED                  (admin resolves without a review step)
 *   RESOLVED -> CLOSED
 *
 * There is no REJECTED status for SupportTicket (unlike Dispute) — a
 * support ticket is not "upheld or declined", it's simply worked until
 * resolved or closed; see docs/MODULE_21_DISPUTES_SUPPORT.md, "Support
 * Tickets vs Disputes" for the full reasoning. CLOSED is the sole terminal
 * status; reopening a closed ticket is out of scope, same MVP limitation as
 * Dispute.
 */

export const OPEN_STATUS: SupportTicketStatusValue = "OPEN";
export const IN_PROGRESS_STATUS: SupportTicketStatusValue = "IN_PROGRESS";
export const WAITING_FOR_USER_STATUS: SupportTicketStatusValue = "WAITING_FOR_USER";
export const RESOLVED_STATUS: SupportTicketStatusValue = "RESOLVED";
export const CLOSED_STATUS: SupportTicketStatusValue = "CLOSED";

export const NON_TERMINAL_STATUSES: readonly SupportTicketStatusValue[] = [
  OPEN_STATUS,
  IN_PROGRESS_STATUS,
  WAITING_FOR_USER_STATUS,
  RESOLVED_STATUS,
];

export function isTerminalStatus(status: SupportTicketStatusValue): boolean {
  return status === CLOSED_STATUS;
}

export function isWaitingOnUser(status: SupportTicketStatusValue): boolean {
  return status === WAITING_FOR_USER_STATUS;
}

const TRANSITIONS: Record<SupportTicketStatusValue, readonly SupportTicketStatusValue[]> = {
  OPEN: [IN_PROGRESS_STATUS, RESOLVED_STATUS],
  IN_PROGRESS: [WAITING_FOR_USER_STATUS, RESOLVED_STATUS],
  WAITING_FOR_USER: [IN_PROGRESS_STATUS, RESOLVED_STATUS],
  RESOLVED: [CLOSED_STATUS],
  CLOSED: [],
};

export function canTransitionSupportTicketStatus(
  from: SupportTicketStatusValue,
  to: SupportTicketStatusValue,
): boolean {
  if (from === to) return false;
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function isResolvableStatus(status: SupportTicketStatusValue): boolean {
  return canTransitionSupportTicketStatus(status, RESOLVED_STATUS);
}

export function isClosableStatus(status: SupportTicketStatusValue): boolean {
  return canTransitionSupportTicketStatus(status, CLOSED_STATUS);
}
