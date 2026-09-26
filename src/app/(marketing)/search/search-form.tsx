"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { SearchSortOption } from "@/domain/value-objects/search-sort-option";
import { LocationPicker } from "./location-picker";

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
  // Module 42 — Geocoding & Maps: additive, matching exactly the extension
  // point Module 20's own page.tsx doc comment already forward-referenced
  // ("a future map-based UI ... can navigate here with lat/lng/radiusKm
  // query params without any change to this page").
  latitude?: number;
  longitude?: number;
  radiusKm?: number;
}

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
  const t = useTranslations("marketing");
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
    if (values.latitude !== undefined && values.longitude !== undefined) {
      params.set("lat", String(values.latitude));
      params.set("lng", String(values.longitude));
      if (values.radiusKm !== undefined) params.set("radiusKm", String(values.radiusKm));
    }
    params.set("sortBy", values.sortBy);
    router.push(`/search?${params.toString()}`);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1">
        <label htmlFor="q" className="text-sm font-medium">
          {t("search.form.queryLabel")}
        </label>
        <input
          id="q"
          type="text"
          placeholder={t("search.form.queryPlaceholder")}
          className="h-10 rounded-md border border-border px-3 text-sm"
          value={values.query ?? ""}
          onChange={(e) => setValues((v) => ({ ...v, query: e.target.value }))}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="categoryId" className="text-sm font-medium">
            {t("search.form.serviceLabel")}
          </label>
          <select
            id="categoryId"
            className="h-10 rounded-md border border-border px-3 text-sm"
            value={values.categoryId ?? ""}
            onChange={(e) => setValues((v) => ({ ...v, categoryId: e.target.value || undefined }))}
          >
            <option value="">{t("search.form.anyService")}</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="city" className="text-sm font-medium">
            {t("search.form.cityLabel")}
          </label>
          <input
            id="city"
            type="text"
            placeholder={t("search.form.cityPlaceholder")}
            className="h-10 rounded-md border border-border px-3 text-sm"
            value={values.city ?? ""}
            onChange={(e) => setValues((v) => ({ ...v, city: e.target.value || undefined }))}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="minRating" className="text-sm font-medium">
            {t("search.form.minRatingLabel")}
          </label>
          <select
            id="minRating"
            className="h-10 rounded-md border border-border px-3 text-sm"
            value={values.minRating ?? ""}
            onChange={(e) => setValues((v) => ({ ...v, minRating: e.target.value ? Number(e.target.value) : undefined }))}
          >
            <option value="">{t("search.form.anyRating")}</option>
            {[3, 3.5, 4, 4.5].map((rating) => (
              <option key={rating} value={rating}>
                {t("search.form.ratingOption", { rating })}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="sortBy" className="text-sm font-medium">
            {t("search.form.sortByLabel")}
          </label>
          <select
            id="sortBy"
            className="h-10 rounded-md border border-border px-3 text-sm"
            value={values.sortBy}
            onChange={(e) => setValues((v) => ({ ...v, sortBy: e.target.value as SearchSortOption }))}
          >
            {sortOptions.map((option) => (
              <option key={option} value={option}>
                {t(`search.form.sort.${option}`)}
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
        {t("search.form.verifiedOnly")}
      </label>

      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">{t("search.form.nearLocation")}</span>
        <LocationPicker
          value={{ latitude: values.latitude, longitude: values.longitude, radiusKm: values.radiusKm }}
          onChange={(location) => setValues((v) => ({ ...v, ...location }))}
        />
      </div>

      <Button type="submit">{t("search.form.submit")}</Button>
    </form>
  );
}
