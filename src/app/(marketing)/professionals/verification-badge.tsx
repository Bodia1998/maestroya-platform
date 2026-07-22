const VERIFICATION_STYLES: Record<string, string> = {
  UNVERIFIED: "bg-black/5 text-foreground/70",
  PENDING: "bg-amber-50 text-amber-700",
  VERIFIED: "bg-green-50 text-green-700",
  REJECTED: "bg-red-50 text-red-700",
};

const VERIFICATION_LABELS: Record<string, string> = {
  UNVERIFIED: "Not verified",
  PENDING: "Verification pending",
  VERIFIED: "Verified professional",
  REJECTED: "Verification rejected",
};

/**
 * Public-facing verification badge for Professional Discovery search
 * results and public profiles. Deliberately shows only
 * `verificationStatus` — unlike the dashboard's StatusBadges, there is no
 * profile `status` to show here because discovery only ever surfaces
 * ACTIVE professionals in the first place (see
 * ProfessionalDiscoveryRepository).
 */
export function VerificationBadge({ verificationStatus }: { verificationStatus: string }) {
  return (
    <span
      className={`inline-flex w-fit rounded-full px-3 py-1 text-xs font-medium ${
        VERIFICATION_STYLES[verificationStatus] ?? "bg-black/5"
      }`}
    >
      {VERIFICATION_LABELS[verificationStatus] ?? verificationStatus}
    </span>
  );
}
