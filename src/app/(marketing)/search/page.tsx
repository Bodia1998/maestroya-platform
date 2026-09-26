import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { prisma } from "@/infrastructure/database/prisma/client";
import { searchDirectorySchema } from "@/application/dto/search.dto";
import { makeSearchDirectoryUseCase } from "@/application/use-cases/search/compose";
import type { SearchDirectoryResult } from "@/application/use-cases/search/search-directory.use-case";
import { SEARCH_SORT_OPTIONS } from "@/domain/value-objects/search-sort-option";
import { PageContainer } from "@/components/layout/page-container";
import { Section } from "@/components/layout/section";
import { SearchResultsMap } from "@/components/maps/search-results-map";
import { localizeActionError } from "@/presentation/i18n/server";
import { localizeCategoryName } from "@/presentation/i18n/service-categories";
import { DirectorySearchForm } from "./search-form";
import { DirectorySearchResultsList } from "./results-list";

/** Module 43 — SEO Infrastructure: see `(marketing)/professionals/page.tsx`'s
 *  own doc comment on why `alternates.canonical` is the bare path — same
 *  reasoning applies here for `/search`'s own query-string filters. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("marketing");
  const title = t("meta.search.title");
  const description = t("meta.search.description");
  return {
    title,
    description,
    alternates: { canonical: "/search" },
    openGraph: { title, description, url: "/search" },
    twitter: { title, description },
  };
}

/**
 * Search & Ranking module (Module 19) — unified, customer-facing directory
 * search page.
 *
 * Same convention Professional Discovery's own page established: a Server
 * Component reads the search from the URL's query string and, when
 * present, runs SearchDirectoryUseCase directly — no Server Action, since
 * this is a read, not a mutation. This is a NEW route (`/search`) alongside
 * the existing `/professionals` (radius-based) and `/companies` pages —
 * it does not replace either; see docs/MODULE_19_SEARCH_RANKING.md,
 * "Relationship to Professional Discovery".
 */
export default async function DirectorySearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const [t, tCommon, tServices] = await Promise.all([
    getTranslations("marketing"),
    getTranslations("common"),
    getTranslations("services"),
  ]);

  const categoryRows = await prisma.serviceCategory.findMany({
    where: { status: "ACTIVE", deletedAt: null },
    select: { id: true, name: true, slug: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  const categories = categoryRows.map((category) => ({
    id: category.id,
    name: localizeCategoryName(tServices, category),
  }));

  const raw = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : undefined);

  const parsed = searchDirectorySchema.safeParse({
    query: raw("q"),
    categoryId: raw("categoryId"),
    city: raw("city"),
    province: raw("province"),
    verifiedOnly: raw("verifiedOnly"),
    minRating: raw("minRating"),
    minReviewCount: raw("minReviewCount"),
    sortBy: raw("sortBy"),
    page: raw("page"),
    pageSize: raw("pageSize"),
    // Maps & Geolocation module (Module 20): optional — a future map-based
    // UI (e.g. browser geolocation, a map picker) can navigate here with
    // `lat`/`lng`/`radiusKm` query params without any change to this page;
    // absent, search behaves exactly as it did before this module.
    latitude: raw("lat"),
    longitude: raw("lng"),
    radiusKm: raw("radiusKm"),
  });

  const hasAnyFilter = Boolean(
    raw("q") || raw("categoryId") || raw("city") || raw("province") || raw("verifiedOnly") || raw("minRating"),
  );

  let results: SearchDirectoryResult | null = null;
  let searchError: string | null = null;

  if (hasAnyFilter) {
    if (!parsed.success) {
      searchError = t("search.invalid");
    } else {
      try {
        results = await makeSearchDirectoryUseCase().execute(parsed.data);
      } catch (error) {
        searchError = await localizeActionError(error, t("search.failed"));
      }
    }
  }

  return (
    <PageContainer maxWidth="3xl" padded>
      <div>
        <h1 className="text-2xl font-semibold">{t("search.heading")}</h1>
        <p className="mt-1 text-sm text-foreground/70">
          {t("search.subtitle")}
        </p>
      </div>

      <DirectorySearchForm
        categories={categories}
        sortOptions={SEARCH_SORT_OPTIONS}
        defaultValues={{
          query: raw("q"),
          categoryId: raw("categoryId"),
          city: raw("city"),
          province: raw("province"),
          verifiedOnly: raw("verifiedOnly") === "true",
          minRating: raw("minRating") ? Number(raw("minRating")) : undefined,
          sortBy: (raw("sortBy") as (typeof SEARCH_SORT_OPTIONS)[number]) ?? "RELEVANCE",
        }}
      />

      {searchError && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {searchError}
        </p>
      )}

      {hasAnyFilter && !searchError && results && (
        <Section title={t("search.resultsFound", { count: results.total })}>
          {/* Module 42 — Geocoding & Maps: renders alongside the list, not
              instead of it — the map is a visual complement to
              DirectorySearchResultsList, which remains the primary,
              accessible way to browse results. */}
          <SearchResultsMap results={results.items} />
          <DirectorySearchResultsList results={results.items} />
          {results.total > results.pageSize && (
            <nav className="flex items-center justify-between text-sm">
              {results.page > 1 && (
                <Link href={buildPageHref(params, results.page - 1)} className="underline">
                  {tCommon("pagination.previous")}
                </Link>
              )}
              <span className="text-foreground/60">
                {tCommon("pagination.pageOf", {
                  page: results.page,
                  total: Math.ceil(results.total / results.pageSize),
                })}
              </span>
              {results.page * results.pageSize < results.total && (
                <Link href={buildPageHref(params, results.page + 1)} className="underline">
                  {tCommon("pagination.next")}
                </Link>
              )}
            </nav>
          )}
        </Section>
      )}
    </PageContainer>
  );
}

function buildPageHref(params: Record<string, string | string[] | undefined>, page: number): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string" && key !== "page") search.set(key, value);
  }
  search.set("page", String(page));
  return `/search?${search.toString()}`;
}
