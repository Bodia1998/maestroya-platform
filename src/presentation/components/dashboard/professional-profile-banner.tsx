import Link from "next/link";

import type { ProfessionalProfileBannerInfo } from "@/shared/utils/professional-profile-banner";

/**
 * Presentational rendering of the decision produced by
 * professional-profile-banner.ts. Kept as a tiny, dumb Server Component —
 * all the actual logic (when to show it, what it says) lives in that pure
 * function so it can be unit-tested without rendering anything.
 */
export function ProfessionalProfileBanner({ info }: { info: ProfessionalProfileBannerInfo }) {
  if (!info.show) return null;

  return (
    <div className="flex flex-col items-start justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:flex-row sm:items-center">
      <p>{info.message}</p>
      <Link
        href={info.ctaHref}
        className="shrink-0 rounded-md bg-amber-900 px-3 py-1.5 text-xs font-medium text-amber-50 hover:bg-amber-800"
      >
        {info.ctaLabel}
      </Link>
    </div>
  );
}
