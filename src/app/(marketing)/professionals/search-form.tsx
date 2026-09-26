"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm, type Resolver } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { searchProfessionalsSchema } from "@/application/dto/discovery.dto";
import { useLocalizedZodResolver } from "@/hooks/use-localized-errors";

const searchFormSchema = searchProfessionalsSchema.pick({
  categoryId: true,
  latitude: true,
  longitude: true,
});
type SearchFormInput = {
  categoryId: string;
  latitude: number | undefined;
  longitude: number | undefined;
};

interface CategoryOption {
  id: string;
  name: string;
}

/**
 * Customer-facing search form for Professional Discovery. There is no map
 * or geocoding provider in this project yet, so location is entered as
 * latitude/longitude directly — kept deliberately simple per the module's
 * MVP scope, with a "use my current location" convenience button backed
 * by the browser's own Geolocation API (no external service call).
 *
 * Submitting navigates to this same page with the search encoded as query
 * params, so results are rendered by the Server Component in page.tsx via
 * SearchProfessionalsUseCase — no client-side data fetching of search
 * results themselves.
 */
export function ProfessionalSearchForm({
  categories,
  defaultValues,
}: {
  categories: CategoryOption[];
  defaultValues?: Partial<SearchFormInput>;
}) {
  const t = useTranslations("marketing");
  const router = useRouter();
  const [locationError, setLocationError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<SearchFormInput>({
    resolver: useLocalizedZodResolver(searchFormSchema) as unknown as Resolver<SearchFormInput>,
    defaultValues: {
      categoryId: defaultValues?.categoryId ?? "",
      latitude: defaultValues?.latitude,
      longitude: defaultValues?.longitude,
    },
  });

  function useMyLocation() {
    setLocationError(null);
    if (!navigator.geolocation) {
      setLocationError(t("professionals.form.notSupported"));
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setValue("latitude", Number(position.coords.latitude.toFixed(6)));
        setValue("longitude", Number(position.coords.longitude.toFixed(6)));
        setLocating(false);
      },
      () => {
        setLocationError(t("professionals.form.locationFailed"));
        setLocating(false);
      },
    );
  }

  function onSubmit(data: SearchFormInput) {
    const params = new URLSearchParams({
      categoryId: data.categoryId,
      lat: String(data.latitude),
      lng: String(data.longitude),
    });
    router.push(`/professionals?${params.toString()}`);
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1">
        <label htmlFor="categoryId" className="text-sm font-medium">
          {t("professionals.form.serviceLabel")}
        </label>
        <select
          id="categoryId"
          className="h-10 rounded-md border border-border px-3 text-sm"
          {...register("categoryId")}
        >
          <option value="">{t("professionals.form.selectService")}</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        {errors.categoryId && <p className="text-xs text-red-600">{errors.categoryId.message}</p>}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="latitude" className="text-sm font-medium">
            {t("professionals.form.latitude")}
          </label>
          <input
            id="latitude"
            type="number"
            step="any"
            placeholder={t("professionals.form.latitudePlaceholder")}
            className="h-10 rounded-md border border-border px-3 text-sm"
            {...register("latitude")}
          />
          {errors.latitude && <p className="text-xs text-red-600">{errors.latitude.message}</p>}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="longitude" className="text-sm font-medium">
            {t("professionals.form.longitude")}
          </label>
          <input
            id="longitude"
            type="number"
            step="any"
            placeholder={t("professionals.form.longitudePlaceholder")}
            className="h-10 rounded-md border border-border px-3 text-sm"
            {...register("longitude")}
          />
          {errors.longitude && <p className="text-xs text-red-600">{errors.longitude.message}</p>}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button type="button" variant="outline" size="sm" onClick={useMyLocation} disabled={locating}>
          {locating ? t("professionals.form.locating") : t("professionals.form.useMyLocation")}
        </Button>
        {locationError && <p className="text-xs text-red-600">{locationError}</p>}
      </div>

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? t("professionals.form.submitting") : t("professionals.form.submit")}
      </Button>
    </form>
  );
}
