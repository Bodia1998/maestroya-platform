const STATUS_STYLES: Record<string, string> = {
  ACTIVE: "bg-green-50 text-green-700",
  INACTIVE: "bg-black/5 text-foreground/70",
  SUSPENDED: "bg-red-50 text-red-700",
};

const VERIFICATION_STYLES: Record<string, string> = {
  UNVERIFIED: "bg-black/5 text-foreground/70",
  PENDING: "bg-amber-50 text-amber-700",
  VERIFIED: "bg-green-50 text-green-700",
  REJECTED: "bg-red-50 text-red-700",
};

const VERIFICATION_LABELS: Record<string, string> = {
  UNVERIFIED: "Not verified",
  PENDING: "Verification pending",
  VERIFIED: "Verified",
  REJECTED: "Verification rejected",
};

/**
 * Read-only display of profile/verification status. Deliberately no
 * control here to change verificationStatus — it's admin-only (see
 * DeactivateProfessionalUseCase / professional.dto.ts) — this component
 * only ever shows the current value.
 */
export function StatusBadges({
  status,
  verificationStatus,
}: {
  status: string;
  verificationStatus: string;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <span
        className={`rounded-full px-3 py-1 text-xs font-medium ${STATUS_STYLES[status] ?? "bg-black/5"}`}
      >
        Status: {status}
      </span>
      <span
        className={`rounded-full px-3 py-1 text-xs font-medium ${
          VERIFICATION_STYLES[verificationStatus] ?? "bg-black/5"
        }`}
      >
        {VERIFICATION_LABELS[verificationStatus] ?? verificationStatus}
      </span>
    </div>
  );
}
