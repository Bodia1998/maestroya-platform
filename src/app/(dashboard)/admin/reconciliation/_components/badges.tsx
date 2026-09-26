import { useTranslations } from "next-intl";

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

export function SeverityBadge({ severity, className }: { severity: string; className?: string }) {
  const variant = SEVERITY_VARIANT[severity as keyof typeof SEVERITY_VARIANT] ?? "secondary";
  const t = useTranslations("admin.reconciliation");
  const label = severity in SEVERITY_VARIANT ? t(`severity.${severity as keyof typeof SEVERITY_VARIANT}`) : severity;
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

export function ResolutionStatusBadge({ status, className }: { status: string; className?: string }) {
  const variant = RESOLUTION_STATUS_VARIANT[status as keyof typeof RESOLUTION_STATUS_VARIANT] ?? "secondary";
  const t = useTranslations("admin.reconciliation");
  const label =
    status in RESOLUTION_STATUS_VARIANT
      ? t(`resolutionStatus.${status as keyof typeof RESOLUTION_STATUS_VARIANT}`)
      : status;
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

export function RunStatusBadge({ status, className }: { status: string; className?: string }) {
  const variant = RUN_STATUS_VARIANT[status as keyof typeof RUN_STATUS_VARIANT] ?? "secondary";
  const t = useTranslations("admin.reconciliation");
  const label = status in RUN_STATUS_VARIANT ? t(`runStatus.${status as keyof typeof RUN_STATUS_VARIANT}`) : status;
  return (
    <Badge variant={variant} className={className}>
      {label}
    </Badge>
  );
}
