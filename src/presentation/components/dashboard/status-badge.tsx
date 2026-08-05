import { Badge, type BadgeProps } from "@/components/ui/badge";
import { cn } from "@/shared/utils/cn";

/**
 * Unified status vocabulary across every module that renders a lifecycle
 * status as a badge (Service Requests, Quotes, Appointments, Jobs,
 * Professional/Company profiles, Disputes, Support tickets, Verification).
 *
 * Each per-module status enum (see e.g. `domain/services/service-request-state.ts`,
 * `domain/services/quote-state.ts`, `domain/services/appointment-state.ts`)
 * keeps its own raw string values — this map is deliberately keyed by the
 * union of every one of those literal values (read-only, nothing in
 * `src/domain` is modified here) to a single color/variant so the same
 * status always looks the same regardless of which module rendered it.
 * A handful of values collide across modules with different meanings
 * (e.g. quote `EXPIRED` vs. request `EXPIRED`) but always map to the same
 * semantic color, so a shared key is safe.
 */
const STATUS_VARIANT: Record<string, BadgeProps["variant"]> = {
  // Neutral / not-yet-started
  DRAFT: "secondary",
  CREATED: "secondary",
  PENDING: "secondary",
  PENDING_SCHEDULE: "secondary",
  UNVERIFIED: "secondary",
  INACTIVE: "secondary",
  WITHDRAWN: "secondary",
  CLOSED: "secondary",
  RESOLVED: "secondary",
  RESUBMISSION_REQUIRED: "warning",

  // Open / awaiting a decision
  PUBLISHED: "success",
  OPEN: "success",
  ACTIVE: "success",
  SENT: "accent",
  VIEWED: "accent",
  PROPOSED: "accent",
  QUOTED: "accent",
  SUBMITTED: "accent",

  // In progress / scheduled
  IN_PROGRESS: "warning",
  SCHEDULED: "warning",
  CONFIRMED: "warning",
  RESCHEDULED: "warning",
  PENDING_REVIEW: "warning",
  UNDER_REVIEW: "warning",

  // Positive terminal
  ACCEPTED: "default",
  COMPLETED: "success",
  VERIFIED: "success",
  APPROVED: "success",

  // Negative / terminal-with-friction
  REJECTED: "danger",
  CANCELLED: "danger",
  EXPIRED: "secondary",
  SUSPENDED: "danger",
  DISPUTED: "danger",
  DECLINED: "danger",
};

/** Human-facing label overrides — falls back to a title-cased version of the raw status. */
const STATUS_LABEL: Record<string, string> = {
  PUBLISHED: "Open",
  PENDING_SCHEDULE: "Awaiting schedule",
  IN_PROGRESS: "In progress",
  PENDING_REVIEW: "Pending review",
  UNDER_REVIEW: "Under review",
  UNVERIFIED: "Not verified",
};

function toTitleCase(status: string): string {
  return status
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export interface StatusBadgeProps {
  /** Raw enum/status string from any domain module (case-sensitive, matches the DB/enum value). */
  status: string;
  /** Overrides the auto-derived label (e.g. to prefix with "Status: "). */
  label?: string;
  className?: string;
}

/**
 * Single source of truth for "status string → badge color + label" across
 * every dashboard page. Built on the Module 30.1 `Badge` primitive — this
 * component owns only the status vocabulary, not a new visual style.
 *
 * Replaces the near-identical `STATUS_STYLES`/`STATUS_LABELS` maps that
 * used to be hand-duplicated in `request-status-badge.tsx`,
 * `appointment-status-badge.tsx`, `quote-status-badge.tsx`,
 * `job-status-badge.tsx`, and `status-badges.tsx` — those files now each
 * delegate to this one, keeping their existing exported names (and every
 * call site across the app) unchanged.
 */
export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  const variant = STATUS_VARIANT[status] ?? "secondary";
  const text = label ?? STATUS_LABEL[status] ?? toTitleCase(status);
  return (
    <Badge variant={variant} className={cn("whitespace-nowrap", className)}>
      {text}
    </Badge>
  );
}
