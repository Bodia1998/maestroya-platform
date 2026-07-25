"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { SearchSortOption } from "@/domain/value-objects/search-sort-option";

interface CategoryOption {
  id: string;
  name: string;
}

interface DirectorySearchFormValues {
  query?: string;
  categoryId?: string;
  city?: string;
  province?: string;
  verifiedOnly?: boolean;
  minRating?: number;
  sortBy: SearchSortOption;
}

const SORT_LABELS: Record<SearchSortOption, string> = {
  RELEVANCE: "Best match",
  RATING: "Highest rated",
  REVIEWS: "Most reviewed",
  NEWEST: "Newest",
  VERIFIED: "Verified first",
};

/**
 * Search & Ranking module (Module 19) — unified directory search form.
 *
 * Same pattern as ProfessionalSearchForm (Professional Discovery): a plain
 * client form that navigates to this same page with the search encoded as
 * query params, so results are rendered by the Server Component in
 * page.tsx via SearchDirectoryUseCase — no client-side data fetching.
 */
export function DirectorySearchForm({
  categories,
  sortOptions,
  defaultValues,
}: {
  categories: CategoryOption[];
  sortOptions: readonly SearchSortOption[];
  defaultValues: DirectorySearchFormValues;
}) {
  const router = useRouter();
  const [values, setValues] = useState<DirectorySearchFormValues>(defaultValues);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (values.query) params.set("q", values.query);
    if (values.categoryId) params.set("categoryId", values.categoryId);
    if (values.city) params.set("city", values.city);
    if (values.province) params.set("province", values.province);
    if (values.verifiedOnly) params.set("verifiedOnly", "true");
    if (values.minRating) params.set("minRating", String(values.minRating));
    params.set("sortBy", values.sortBy);
    router.push(`/search?${params.toString()}`);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1">
        <label htmlFor="q" className="text-sm font-medium">
          What do you need?
        </label>
        <input
          id="q"
          type="text"
          placeholder="e.g. electrician, air conditioning…"
          className="h-10 rounded-md border border-border px-3 text-sm"
          value={values.query ?? ""}
          onChange={(e) => setValues((v) => ({ ...v, query: e.target.value }))}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="categoryId" className="text-sm font-medium">
            Service
          </label>
          <select
            id="categoryId"
            className="h-10 rounded-md border border-border px-3 text-sm"
            value={values.categoryId ?? ""}
            onChange={(e) => setValues((v) => ({ ...v, categoryId: e.target.value || undefined }))}
          >
            <option value="">Any service</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="city" className="text-sm font-medium">
            City
          </label>
          <input
            id="city"
            type="text"
            placeholder="e.g. Gandia"
            className="h-10 rounded-md border border-border px-3 text-sm"
            value={values.city ?? ""}
            onChange={(e) => setValues((v) => ({ ...v, city: e.target.value || undefined }))}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="minRating" className="text-sm font-medium">
            Minimum rating
          </label>
          <select
            id="minRating"
            className="h-10 rounded-md border border-border px-3 text-sm"
            value={values.minRating ?? ""}
            onChange={(e) => setValues((v) => ({ ...v, minRating: e.target.value ? Number(e.target.value) : undefined }))}
          >
            <option value="">Any rating</option>
            {[3, 3.5, 4, 4.5].map((rating) => (
              <option key={rating} value={rating}>
                {rating}+ stars
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="sortBy" className="text-sm font-medium">
            Sort by
          </label>
          <select
            id="sortBy"
            className="h-10 rounded-md border border-border px-3 text-sm"
            value={values.sortBy}
            onChange={(e) => setValues((v) => ({ ...v, sortBy: e.target.value as SearchSortOption }))}
          >
            {sortOptions.map((option) => (
              <option key={option} value={option}>
                {SORT_LABELS[option]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={values.verifiedOnly ?? false}
          onChange={(e) => setValues((v) => ({ ...v, verifiedOnly: e.target.checked }))}
        />
        Verified only
      </label>

      <Button type="submit">Search</Button>
    </form>
  );
}
