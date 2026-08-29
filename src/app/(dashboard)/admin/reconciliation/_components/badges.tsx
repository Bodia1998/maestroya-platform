import { Badge } from "@/components/ui/badge";

/**
 * Module 81 — Reconciliation Admin Dashboard & Operations: small, scoped
 * badge components for the three status vocabularies this feature
 * introduces (discrepancy severity, discrepancy resolution status, run
 * status). Deliberately NOT added to the shared `StatusBadge`
 * (`components/dashboard/status-badge.tsx`) vocabulary — that map is keyed
 * by raw string value across every module, and several of these values
 * collide with an existing entry whose color means something different
 * there (e.g. `OPEN` is already mapped to `"success"` for a Service
 * Request that's open for quotes — the opposite of what "open" means for
 * an unresolved financial discrepancy, which needs attention and must
 * never read as good news). Kept local to this feature instead of risking
 * a shared-vocabulary collision.
 */

const SEVERITY_VARIANT = {
  CRITICAL: "danger",
  ERROR: "danger",
  WARNING: "warning",
  INFO: "secondary",
} as const;

const SEVERITY_LABEL = {
  CRITICAL: "Critical",
  ERROR: "High",
  WARNING: "Medium",
  INFO: "Low",
} as const;

export function SeverityBadge({ severity, className }: { severity: string; className?: string }) {
  const variant = SEVERITY_VARIANT[severity as keyof typeof SEVERITY_VARIANT] ?? "secondary";
  const label = SEVERITY_LABEL[severity as keyof typeof SEVERITY_LABEL] ?? severity;
  return (
    <Badge variant={variant} className={className}>
      {label}
    </Badge>
  );
}

const RESOLUTION_STATUS_VARIANT = {
  OPEN: "warning",
  RESOLVED: "success",
} as const;

const RESOLUTION_STATUS_LABEL = {
  OPEN: "Open",
  RESOLVED: "Resolved",
} as const;

export function ResolutionStatusBadge({ status, className }: { status: string; className?: string }) {
  const variant = RESOLUTION_STATUS_VARIANT[status as keyof typeof RESOLUTION_STATUS_VARIANT] ?? "secondary";
  const label = RESOLUTION_STATUS_LABEL[status as keyof typeof RESOLUTION_STATUS_LABEL] ?? status;
  return (
    <Badge variant={variant} className={className}>
      {label}
    </Badge>
  );
}

const RUN_STATUS_VARIANT = {
  RUNNING: "warning",
  COMPLETED: "success",
  FAILED: "danger",
} as const;

const RUN_STATUS_LABEL = {
  RUNNING: "Running",
  COMPLETED: "Completed",
  FAILED: "Failed",
} as const;

export function RunStatusBadge({ status, className }: { status: string; className?: string }) {
  const variant = RUN_STATUS_VARIANT[status as keyof typeof RUN_STATUS_VARIANT] ?? "secondary";
  const label = RUN_STATUS_LABEL[status as keyof typeof RUN_STATUS_LABEL] ?? status;
  return (
    <Badge variant={variant} className={className}>
      {label}
    </Badge>
  );
}
