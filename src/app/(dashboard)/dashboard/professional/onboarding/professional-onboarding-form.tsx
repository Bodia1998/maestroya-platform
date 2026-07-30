"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import {
  professionalOnboardingSchema,
  type ProfessionalOnboardingInput,
} from "@/application/dto/professional.dto";
import { completeProfessionalOnboardingAction } from "../actions";

interface CategoryOption {
  id: string;
  name: string;
}

/**
 * Professional Onboarding form — required fields only (category, phone,
 * base location, service radius, description), matching the "lightweight
 * onboarding" scope. Deliberately does not include Stripe/bank
 * details/identity verification/tax fields; those are separate,
 * already-roadmapped modules, not part of this flow.
 *
 * On success, `CompleteProfessionalOnboardingUseCase` has already
 * (atomically, inside `CreateProfessionalUseCase`) granted the PROVIDER
 * role and cleared `signupIntent` server-side. This browser's existing
 * session/JWT predates that, so — same mechanism
 * `ProfessionalProfileForm` already uses for first-time profile creation
 * — `update()` re-invokes the `jwt` callback to re-read both from the DB,
 * then a hard redirect lands directly on the Professional Dashboard
 * (never back on the Customer Dashboard, and never showing it first).
 */
export function ProfessionalOnboardingForm({ categories }: { categories: CategoryOption[] }) {
  const { update } = useSession();
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ProfessionalOnboardingInput>({
    resolver: zodResolver(professionalOnboardingSchema),
    defaultValues: {
      categoryIds: [],
      contactPhone: "",
      bio: "",
      serviceRadiusKm: undefined,
      address: {
        line1: "",
        line2: "",
        city: "",
        province: "",
        postalCode: "",
        country: "ES",
      },
    },
  });

  async function onSubmit(data: ProfessionalOnboardingInput) {
    setServerError(null);
    const result = await completeProfessionalOnboardingAction(data);

    if (!result.success) {
      setServerError(result.error);
      return;
    }

    await update();
    router.push("/dashboard/professional");
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-6" noValidate>
      {serverError && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {serverError}
        </p>
      )}

      <fieldset className="flex flex-col gap-3 rounded-md border border-border p-4">
        <legend className="px-1 text-sm font-medium">Primary profession / category</legend>
        <div className="grid grid-cols-2 gap-2">
          {categories.map((category) => (
            <label key={category.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" value={category.id} {...register("categoryIds")} />
              {category.name}
            </label>
          ))}
          {categories.length === 0 && (
            <p className="text-sm text-foreground/70">No service categories are available yet.</p>
          )}
        </div>
        {errors.categoryIds && (
          <p className="text-xs text-red-600">{errors.categoryIds.message}</p>
        )}
      </fieldset>

      <div className="flex flex-col gap-1">
        <label htmlFor="contactPhone" className="text-sm font-medium">
          Phone number
        </label>
        <input
          id="contactPhone"
          type="tel"
          autoComplete="tel"
          className="h-10 rounded-md border border-border px-3 text-sm"
          {...register("contactPhone")}
        />
        {errors.contactPhone && (
          <p className="text-xs text-red-600">{errors.contactPhone.message}</p>
        )}
      </div>

      <fieldset className="flex flex-col gap-3 rounded-md border border-border p-4">
        <legend className="px-1 text-sm font-medium">Base location</legend>
        <input
          className="h-10 rounded-md border border-border px-3 text-sm"
          placeholder="Street address"
          autoComplete="address-line1"
          {...register("address.line1")}
        />
        {errors.address?.line1 && (
          <p className="text-xs text-red-600">{errors.address.line1.message}</p>
        )}
        <input
          className="h-10 rounded-md border border-border px-3 text-sm"
          placeholder="Apartment, suite, etc. (optional)"
          autoComplete="address-line2"
          {...register("address.line2")}
        />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <input
              className="h-10 w-full rounded-md border border-border px-3 text-sm"
              placeholder="City"
              autoComplete="address-level2"
              {...register("address.city")}
            />
            {errors.address?.city && (
              <p className="text-xs text-red-600">{errors.address.city.message}</p>
            )}
          </div>
          <input
            className="h-10 rounded-md border border-border px-3 text-sm"
            placeholder="Province (optional)"
            autoComplete="address-level1"
            {...register("address.province")}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <input
              className="h-10 w-full rounded-md border border-border px-3 text-sm"
              placeholder="Postal code"
              autoComplete="postal-code"
              {...register("address.postalCode")}
            />
            {errors.address?.postalCode && (
              <p className="text-xs text-red-600">{errors.address.postalCode.message}</p>
            )}
          </div>
          <input
            className="h-10 rounded-md border border-border px-3 text-sm"
            placeholder="Country"
            autoComplete="country-name"
            {...register("address.country")}
          />
        </div>
      </fieldset>

      <div className="flex flex-col gap-1">
        <label htmlFor="serviceRadiusKm" className="text-sm font-medium">
          Service radius (km)
        </label>
        <input
          id="serviceRadiusKm"
          type="number"
          min={0}
          className="h-10 rounded-md border border-border px-3 text-sm"
          {...register("serviceRadiusKm")}
        />
        {errors.serviceRadiusKm && (
          <p className="text-xs text-red-600">{errors.serviceRadiusKm.message}</p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="bio" className="text-sm font-medium">
          Short professional description
        </label>
        <textarea
          id="bio"
          rows={4}
          className="rounded-md border border-border px-3 py-2 text-sm"
          {...register("bio")}
        />
        {errors.bio && <p className="text-xs text-red-600">{errors.bio.message}</p>}
      </div>

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Setting up…" : "Finish setting up my professional profile"}
      </Button>
    </form>
  );
}
