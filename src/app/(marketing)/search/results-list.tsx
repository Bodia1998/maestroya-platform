import Link from "next/link";

import type { SearchResult } from "@/domain/entities/search-result";

/**
 * Search & Ranking module (Module 19) — renders the unified list of
 * professional and company results. Deliberately never renders a numeric
 * score — only the customer-safe `rankingReasons` strings the ranking
 * engine produced (see docs/MODULE_19_SEARCH_RANKING.md,
 * "Ranking Transparency").
 */
export function DirectorySearchResultsList({ results }: { results: SearchResult[] }) {
  if (results.length === 0) {
    return <p className="text-sm text-foreground/60">No results match those filters yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {results.map((result) => (
        <li key={`${result.kind}-${result.id}`} className="rounded-md border border-border p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-medium">
                {result.displayName}{" "}
                <span className="text-xs uppercase text-foreground/50">
                  {result.kind === "PROFESSIONAL" ? "Professional" : "Company"}
                </span>
              </p>
              <p className="mt-0.5 text-sm text-foreground/70">
                {[result.city, result.province].filter(Boolean).join(", ") || "Location not set"}
                {result.averageRating !== null && (
                  <>
                    {" · "}
                    {result.averageRating.toFixed(1)}★ ({result.reviewCount})
                  </>
                )}
                {result.kind === "COMPANY" && <> · Team of {result.teamSize}</>}
              </p>
            </div>
            <Link
              href={result.kind === "PROFESSIONAL" ? `/professionals/${result.id}` : `/companies/${result.id}`}
              className="shrink-0 text-sm underline"
            >
              View profile
            </Link>
          </div>

          {result.rankingReasons.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {result.rankingReasons.map((reason) => (
                <li key={reason} className="rounded-full bg-foreground/5 px-2.5 py-1 text-xs text-foreground/70">
                  {reason}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}
