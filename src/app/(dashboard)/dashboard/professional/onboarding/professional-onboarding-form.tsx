"use client";

import { MapPin, Phone, Radar, Sparkles } from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
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
import { useLocalizedZodResolver } from "@/hooks/use-localized-errors";
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
  const t = useTranslations("professional.onboarding.form");
  const { update } = useSession();
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ProfessionalOnboardingInput>({
    resolver: useLocalizedZodResolver(professionalOnboardingSchema),
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
        title={t("categoriesTitle")}
        description={t("categoriesDescription")}
        titleAside={<RequiredBadge />}
      >
        <fieldset className="flex flex-col gap-3 rounded-lg border border-border p-4">
          <legend className="sr-only">{t("categoriesTitle")}</legend>
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
              <p className="text-sm text-muted-foreground">{t("noCategories")}</p>
            )}
          </div>
          <FormFieldError>{errors.categoryIds?.message}</FormFieldError>
        </fieldset>
      </FormSection>

      <FormSection title={t("contactTitle")} titleAside={<RequiredBadge />}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="contactPhone" className="flex items-center gap-1.5">
            <Phone aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
            {t("phone")}
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
        title={t("locationTitle")}
        description={t("locationDescription")}
        titleAside={<RequiredBadge />}
      >
        <fieldset className="flex flex-col gap-3 rounded-lg border border-border p-4">
          <legend className="flex items-center gap-1.5 px-1 text-sm font-medium text-foreground">
            <MapPin aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
            {t("address")}
          </legend>
          <div className="flex flex-col gap-1.5">
            <Input
              placeholder={t("line1Placeholder")}
              autoComplete="address-line1"
              aria-invalid={!!errors.address?.line1}
              {...register("address.line1")}
            />
            <FormFieldError>{errors.address?.line1?.message}</FormFieldError>
          </div>
          <Input
            placeholder={t("line2Placeholder")}
            autoComplete="address-line2"
            {...register("address.line2")}
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Input
                placeholder={t("cityPlaceholder")}
                autoComplete="address-level2"
                aria-invalid={!!errors.address?.city}
                {...register("address.city")}
              />
              <FormFieldError>{errors.address?.city?.message}</FormFieldError>
            </div>
            <Input placeholder={t("provincePlaceholder")} autoComplete="address-level1" {...register("address.province")} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Input
                placeholder={t("postalCodePlaceholder")}
                autoComplete="postal-code"
                aria-invalid={!!errors.address?.postalCode}
                {...register("address.postalCode")}
              />
              <FormFieldError>{errors.address?.postalCode?.message}</FormFieldError>
            </div>
            <Input placeholder={t("countryPlaceholder")} autoComplete="country-name" {...register("address.country")} />
          </div>
        </fieldset>
      </FormSection>

      <FormSection title={t("coverageTitle")}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="serviceRadiusKm" className="flex items-center gap-1.5">
            <Radar aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
            {t("serviceRadius")}
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
            {t("bio")}
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
          {isSubmitting ? t("pending") : t("submit")}
        </Button>
      </FormActions>
    </form>
  );
}
