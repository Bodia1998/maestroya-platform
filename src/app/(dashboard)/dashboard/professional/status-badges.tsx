import { useTranslations } from "next-intl";

import { StatusBadge } from "@/components/dashboard/status-badge";

/**
 * Read-only display of profile/verification status. Deliberately no
 * control here to change verificationStatus — it's admin-only (see
 * DeactivateProfessionalUseCase / professional.dto.ts) — this component
 * only ever shows the current value.
 *
 * Delegates to the shared `StatusBadge` (Module 30.3) for the actual
 * color/label mapping — kept as its own named component so every existing
 * call site across the app keeps working unchanged.
 */
export function StatusBadges({
  status,
  verificationStatus,
}: {
  status: string;
  verificationStatus: string;
}) {
  const t = useTranslations("professional.dashboard");
  const tStatus = useTranslations("enums.status");
  const statusLabel = tStatus.has(status as never) ? tStatus(status as never) : status;
  return (
    <div className="flex flex-wrap gap-2">
      <StatusBadge status={status} label={t("profileStatus", { status: statusLabel })} />
      <StatusBadge status={verificationStatus} />
    </div>
  );
}
