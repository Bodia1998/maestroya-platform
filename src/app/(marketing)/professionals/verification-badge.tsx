import { useTranslations } from "next-intl";

const VERIFICATION_STYLES: Record<string, string> = {
  UNVERIFIED: "bg-black/5 text-foreground/70",
  PENDING: "bg-amber-50 text-amber-700",
  VERIFIED: "bg-green-50 text-green-700",
  REJECTED: "bg-red-50 text-red-700",
};

const VERIFICATION_STATUSES = ["UNVERIFIED", "PENDING", "VERIFIED", "REJECTED"] as const;
type KnownVerificationStatus = (typeof VERIFICATION_STATUSES)[number];

function isKnownStatus(status: string): status is KnownVerificationStatus {
  return (VERIFICATION_STATUSES as readonly string[]).includes(status);
}

/**
 * Public-facing verification badge for Professional Discovery search
 * results and public profiles. Deliberately shows only
 * `verificationStatus` — unlike the dashboard's StatusBadges, there is no
 * profile `status` to show here because discovery only ever surfaces
 * ACTIVE professionals in the first place (see
 * ProfessionalDiscoveryRepository).
 */
export function VerificationBadge({ verificationStatus }: { verificationStatus: string }) {
  const t = useTranslations("marketing");
  return (
    <span
      className={`inline-flex w-fit rounded-full px-3 py-1 text-xs font-medium ${
        VERIFICATION_STYLES[verificationStatus] ?? "bg-black/5"
      }`}
    >
      {isKnownStatus(verificationStatus)
        ? t(`professionals.verification.${verificationStatus}`)
        : verificationStatus}
    </span>
  );
}
