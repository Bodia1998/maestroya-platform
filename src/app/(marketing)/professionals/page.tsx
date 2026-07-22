import { prisma } from "@/infrastructure/database/prisma/client";
import { searchProfessionalsSchema } from "@/application/dto/discovery.dto";
import { makeSearchProfessionalsUseCase } from "@/application/use-cases/discovery/compose";
import type { SearchProfessionalsResult } from "@/application/use-cases/discovery/search-professionals.use-case";
import { DomainError } from "@/domain/errors/domain-error";
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
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
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
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">
            {results.total} professional{results.total === 1 ? "" : "s"} found
          </h2>
          <SearchResultsList results={results.results} categoryNamesById={categoryNamesById} />
        </section>
      )}
    </div>
  );
}
