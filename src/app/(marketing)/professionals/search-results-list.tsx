import Image from "next/image";
import Link from "next/link";

import type { ProfessionalSearchResult } from "@/application/use-cases/discovery/search-professionals.use-case";
import { VerificationBadge } from "./verification-badge";

/**
 * Renders one page of SearchProfessionalsUseCase results. Plain Server
 * Component — no client-side data fetching, matching the project's
 * convention of doing page-level data access via a use case in a Server
 * Component (see (marketing)/page.tsx). Results are already sorted by
 * distance ascending by the use case; this component only renders them in
 * that order.
 */
export function SearchResultsList({
  results,
  categoryNamesById,
}: {
  results: ProfessionalSearchResult[];
  categoryNamesById: Record<string, string>;
}) {
  if (results.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-foreground/70">
        No professionals found for this service near that location yet.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {results.map((professional) => (
        <li key={professional.id}>
          <Link
            href={`/professionals/${professional.id}`}
            className="flex gap-4 rounded-md border border-border p-4 transition-colors hover:bg-black/5"
          >
            <div className="h-14 w-14 shrink-0 overflow-hidden rounded-full bg-black/5">
              {professional.profileImageUrl && (
                <Image
                  src={professional.profileImageUrl}
                  alt=""
                  width={56}
                  height={56}
                  className="h-14 w-14 object-cover"
                />
              )}
            </div>

            <div className="flex flex-1 flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">
                  {professional.businessName ?? professional.displayName}
                </span>
                <span className="whitespace-nowrap text-sm text-foreground/70">
                  {professional.distanceKm} km away
                </span>
              </div>

              {professional.headline && (
                <p className="text-sm text-foreground/70">{professional.headline}</p>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <VerificationBadge verificationStatus={professional.verificationStatus} />
                {professional.categoryIds.map((categoryId) =>
                  categoryNamesById[categoryId] ? (
                    <span
                      key={categoryId}
                      className="rounded-full bg-black/5 px-3 py-1 text-xs text-foreground/70"
                    >
                      {categoryNamesById[categoryId]}
                    </span>
                  ) : null,
                )}
              </div>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
