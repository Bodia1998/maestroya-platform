import Link from "next/link";

import { prisma } from "@/infrastructure/database/prisma/client";
import { searchProfessionalsSchema } from "@/application/dto/discovery.dto";
import { searchCompaniesSchema } from "@/application/dto/company.dto";
import { makeSearchProfessionalsUseCase, makeSearchCompaniesUseCase } from "@/application/use-cases/discovery/compose";
import type { SearchProfessionalsResult } from "@/application/use-cases/discovery/search-professionals.use-case";
import type { SearchCompaniesResult } from "@/application/use-cases/discovery/search-companies.use-case";
import { DomainError } from "@/domain/errors/domain-error";
import { PageContainer } from "@/components/layout/page-container";
import { Section } from "@/components/layout/section";
import { ProfessionalSearchForm } from "./search-form";
import { SearchResultsList } from "./search-results-list";

export const metadata = { title: "Find a professional" };

/**
 * Customer-facing Professional Discovery & Search page.
 *
 * A Server Component that reads the search (service category + lat/lng)
 * from the URL's query string and, when present, runs
 * SearchProfessionalsUseCase directly (no Server Action needed — this is a
 * read, not a mutation, matching the project's convention of doing
 * page-level data fetching in the Server Component itself). Results are
 * ordered by distance ascending, per the module's core requirement.
 */
export default async function ProfessionalsSearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  // Static reference data for the category picker — a plain read, not a
  // use case (no business logic), matching the professional dashboard's
  // own category-list read.
  const categories = await prisma.serviceCategory.findMany({
    where: { status: "ACTIVE", deletedAt: null },
    select: { id: true, name: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  const categoryNamesById = Object.fromEntries(categories.map((c) => [c.id, c.name]));

  const rawCategoryId = typeof params.categoryId === "string" ? params.categoryId : undefined;
  const rawLat = typeof params.lat === "string" ? params.lat : undefined;
  const rawLng = typeof params.lng === "string" ? params.lng : undefined;

  const hasSearch = Boolean(rawCategoryId && rawLat && rawLng);

  let results: SearchProfessionalsResult | null = null;
  let searchError: string | null = null;
  // Module 18 — Company Professional: companies are integrated into
  // discovery as a distinct result section alongside individual
  // professionals (see SearchCompaniesUseCase's own doc comment on why this
  // stays a separate query/shape rather than a merged, polymorphic result).
  // Companies have no geo-radius matching yet, so this only depends on
  // categoryId, not lat/lng.
  let companyResults: SearchCompaniesResult | null = null;

  if (hasSearch) {
    const parsed = searchProfessionalsSchema.safeParse({
      categoryId: rawCategoryId,
      latitude: rawLat,
      longitude: rawLng,
    });

    if (!parsed.success) {
      searchError = "That search looks invalid — please try again.";
    } else {
      try {
        results = await makeSearchProfessionalsUseCase().execute(parsed.data);
      } catch (error) {
        searchError =
          error instanceof DomainError ? error.message : "Something went wrong running that search.";
      }
    }

    const companyParsed = searchCompaniesSchema.safeParse({ categoryId: rawCategoryId });
    if (companyParsed.success) {
      try {
        companyResults = await makeSearchCompaniesUseCase().execute(companyParsed.data);
      } catch {
        companyResults = null;
      }
    }
  }

  return (
    <PageContainer padded>
      <div>
        <h1 className="text-2xl font-semibold">Find a professional</h1>
        <p className="mt-1 text-sm text-foreground/70">
          Search by service and location to see professionals who cover your area.
        </p>
      </div>

      <ProfessionalSearchForm
        categories={categories}
        defaultValues={{
          categoryId: rawCategoryId,
          latitude: rawLat ? Number(rawLat) : undefined,
          longitude: rawLng ? Number(rawLng) : undefined,
        }}
      />

      {searchError && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {searchError}
        </p>
      )}

      {hasSearch && !searchError && results && (
        <Section title={`${results.total} professional${results.total === 1 ? "" : "s"} found`}>
          <SearchResultsList results={results.results} categoryNamesById={categoryNamesById} />
        </Section>
      )}

      {hasSearch && companyResults && companyResults.total > 0 && (
        <Section title={`${companyResults.total} compan${companyResults.total === 1 ? "y" : "ies"} found`}>
          <ul className="flex flex-col gap-2">
            {companyResults.results.map((company) => (
              <li key={company.id} className="flex items-center justify-between rounded-md border border-border p-3 text-sm">
                <div>
                  <p className="font-medium">
                    {company.displayName} {company.isVerified && <span className="text-xs text-green-700">✓ Verified</span>}
                  </p>
                  <p className="text-foreground/60">
                    {[company.city, company.province].filter(Boolean).join(", ") || "—"} · Team of {company.teamSize}
                  </p>
                </div>
                <Link href={`/companies/${company.id}`} className="underline">
                  View profile
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </PageContainer>
  );
}
