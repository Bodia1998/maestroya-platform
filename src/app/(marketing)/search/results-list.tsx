import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";

import type { SearchResult } from "@/domain/entities/search-result";

/**
 * Search & Ranking module (Module 19) — renders the unified list of
 * professional and company results. Deliberately never renders a numeric
 * score — only the customer-safe `rankingReasons` strings the ranking
 * engine produced (see docs/MODULE_19_SEARCH_RANKING.md,
 * "Ranking Transparency").
 */
type Translate = ReturnType<typeof useTranslations<"marketing">>;
type Format = ReturnType<typeof useFormatter>;

/**
 * Module 120 — Multilingual Localization: `rankingReasons` are English
 * sentences built by the domain `RankingEngine` (they are also logged and
 * asserted in domain tests, so the domain keeps producing them). Each
 * known shape is mapped back to a catalog key here, at the edge; an
 * unknown reason (a new one added to the engine later) is shown as-is
 * rather than dropped.
 */
const RANKING_REASONS: Array<{
  pattern: RegExp;
  render: (match: RegExpMatchArray, t: Translate, format: Format) => string;
}> = [
  { pattern: /^Verified professional$/, render: (_m, t) => t("search.results.reasons.verified") },
  {
    pattern: /^Highly rated \((\d+(?:\.\d+)?)\/5 from (\d+) reviews?\)$/,
    render: (m, t, format) =>
      t("search.results.reasons.highlyRated", {
        rating: format.number(Number(m[1]), { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
        count: Number(m[2]),
      }),
  },
  { pattern: /^Many completed jobs$/, render: (_m, t) => t("search.results.reasons.manyJobs") },
  { pattern: /^Located in the requested city$/, render: (_m, t) => t("search.results.reasons.inCity") },
  { pattern: /^Located in the requested region$/, render: (_m, t) => t("search.results.reasons.inRegion") },
  {
    pattern: /^Matches the requested service category$/,
    render: (_m, t) => t("search.results.reasons.categoryMatch"),
  },
  {
    pattern: /^Portfolio available \((\d+) items?\)$/,
    render: (m, t) => t("search.results.reasons.portfolio", { count: Number(m[1]) }),
  },
  { pattern: /^Strong, complete profile$/, render: (_m, t) => t("search.results.reasons.completeProfile") },
];

export function localizeRankingReason(reason: string, t: Translate, format: Format): string {
  for (const { pattern, render } of RANKING_REASONS) {
    const match = reason.match(pattern);
    if (match) return render(match, t, format);
  }
  return reason;
}

export function DirectorySearchResultsList({ results }: { results: SearchResult[] }) {
  const t = useTranslations("marketing");
  const format = useFormatter();

  if (results.length === 0) {
    return <p className="text-sm text-foreground/60">{t("search.results.empty")}</p>;
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
                  {result.kind === "PROFESSIONAL"
                    ? t("search.results.kindProfessional")
                    : t("search.results.kindCompany")}
                </span>
              </p>
              <p className="mt-0.5 text-sm text-foreground/70">
                {[result.city, result.province].filter(Boolean).join(", ") || t("directory.locationNotSet")}
                {result.averageRating !== null && (
                  <>
                    {" · "}
                    {format.number(result.averageRating, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}★ (
                    {format.number(result.reviewCount)})
                  </>
                )}
                {result.kind === "COMPANY" && <> · {t("directory.teamOf", { count: result.teamSize })}</>}
              </p>
            </div>
            <Link
              href={result.kind === "PROFESSIONAL" ? `/professionals/${result.id}` : `/companies/${result.id}`}
              className="shrink-0 text-sm underline"
            >
              {t("directory.viewProfile")}
            </Link>
          </div>

          {result.rankingReasons.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {result.rankingReasons.map((reason) => (
                <li key={reason} className="rounded-full bg-foreground/5 px-2.5 py-1 text-xs text-foreground/70">
                  {localizeRankingReason(reason, t, format)}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}
