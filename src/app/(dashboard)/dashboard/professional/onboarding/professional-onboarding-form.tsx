"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { MapPin, Phone, Radar, Sparkles } from "lucide-react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FormActions } from "@/components/forms/form-actions";
import { FormFieldError } from "@/components/forms/form-field-description";
import { FormSection } from "@/components/forms/form-section";
import { RequiredBadge } from "@/components/forms/field-badges";
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
 * then a redirect lands on `/dashboard` — same destination
 * `resolvePostLoginDestination` sends an already-activated PROVIDER to on
 * login (see that file's own doc comment for why: it's the overview that
 * actually renders a "Professional overview" section, not the profile-
 * editing settings page) — never back on the plain Customer Dashboard
 * view, and never showing it first.
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
    router.push("/dashboard");
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-8" noValidate>
      {serverError && (
        <Alert variant="danger" role="alert">
          {serverError}
        </Alert>
      )}

      <FormSection
        title="Primary profession / category"
        description="Choose every category that describes the work you do."
        titleAside={<RequiredBadge />}
      >
        <fieldset className="flex flex-col gap-3 rounded-lg border border-border p-4">
          <legend className="sr-only">Primary profession / category</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {categories.map((category) => (
              <label
                key={category.id}
                className="flex min-h-11 items-center gap-2 rounded-md px-1 text-sm text-foreground"
              >
                <input
                  type="checkbox"
                  value={category.id}
                  className="h-4 w-4 shrink-0 rounded border-input text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  {...register("categoryIds")}
                />
                {category.name}
              </label>
            ))}
            {categories.length === 0 && (
              <p className="text-sm text-muted-foreground">No service categories are available yet.</p>
            )}
          </div>
          <FormFieldError>{errors.categoryIds?.message}</FormFieldError>
        </fieldset>
      </FormSection>

      <FormSection title="Contact" titleAside={<RequiredBadge />}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="contactPhone" className="flex items-center gap-1.5">
            <Phone aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
            Phone number
          </Label>
          <Input
            id="contactPhone"
            type="tel"
            autoComplete="tel"
            aria-invalid={!!errors.contactPhone}
            aria-describedby={errors.contactPhone ? "contactPhone-error" : undefined}
            {...register("contactPhone")}
          />
          <FormFieldError id="contactPhone-error">{errors.contactPhone?.message}</FormFieldError>
        </div>
      </FormSection>

      <FormSection
        title="Base location"
        description="Where you're based — used to match you with nearby requests."
        titleAside={<RequiredBadge />}
      >
        <fieldset className="flex flex-col gap-3 rounded-lg border border-border p-4">
          <legend className="flex items-center gap-1.5 px-1 text-sm font-medium text-foreground">
            <MapPin aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
            Address
          </legend>
          <div className="flex flex-col gap-1.5">
            <Input
              placeholder="Street address"
              autoComplete="address-line1"
              aria-invalid={!!errors.address?.line1}
              {...register("address.line1")}
            />
            <FormFieldError>{errors.address?.line1?.message}</FormFieldError>
          </div>
          <Input
            placeholder="Apartment, suite, etc. (optional)"
            autoComplete="address-line2"
            {...register("address.line2")}
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Input
                placeholder="City"
                autoComplete="address-level2"
                aria-invalid={!!errors.address?.city}
                {...register("address.city")}
              />
              <FormFieldError>{errors.address?.city?.message}</FormFieldError>
            </div>
            <Input placeholder="Province (optional)" autoComplete="address-level1" {...register("address.province")} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Input
                placeholder="Postal code"
                autoComplete="postal-code"
                aria-invalid={!!errors.address?.postalCode}
                {...register("address.postalCode")}
              />
              <FormFieldError>{errors.address?.postalCode?.message}</FormFieldError>
            </div>
            <Input placeholder="Country" autoComplete="country-name" {...register("address.country")} />
          </div>
        </fieldset>
      </FormSection>

      <FormSection title="Coverage & about you">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="serviceRadiusKm" className="flex items-center gap-1.5">
            <Radar aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
            Service radius (km)
            <RequiredBadge />
          </Label>
          <Input
            id="serviceRadiusKm"
            type="number"
            min={0}
            className="sm:max-w-xs"
            aria-invalid={!!errors.serviceRadiusKm}
            aria-describedby={errors.serviceRadiusKm ? "serviceRadiusKm-error" : undefined}
            {...register("serviceRadiusKm")}
          />
          <FormFieldError id="serviceRadiusKm-error">{errors.serviceRadiusKm?.message}</FormFieldError>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bio" className="flex items-center gap-1.5">
            <Sparkles aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
            Short professional description
            <RequiredBadge />
          </Label>
          <Textarea
            id="bio"
            rows={4}
            aria-invalid={!!errors.bio}
            aria-describedby={errors.bio ? "bio-error" : undefined}
            {...register("bio")}
          />
          <FormFieldError id="bio-error">{errors.bio?.message}</FormFieldError>
        </div>
      </FormSection>

      <FormActions stickyOnMobile>
        <Button type="submit" disabled={isSubmitting} className="sm:min-w-64">
          {isSubmitting ? "Setting up…" : "Finish setting up my professional profile"}
        </Button>
      </FormActions>
    </form>
  );
}
