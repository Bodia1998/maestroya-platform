"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { FormActions } from "@/components/forms/form-actions";
import { FormFieldError } from "@/components/forms/form-field-description";
import { FormSection } from "@/components/forms/form-section";
import { OptionalBadge, RequiredBadge } from "@/components/forms/field-badges";
import { saveBillingIdentitySchema, type BillingIdentityDetailsView, type SaveBillingIdentityInput } from "@/application/dto/professional-billing-identity.dto";
import { useLocalizedZodResolver } from "@/hooks/use-localized-errors";
import { saveBillingIdentityAction } from "./actions";

/**
 * Module 146 — billing details form. It only ever submits the billing details
 * themselves: there is no status/verification field anywhere in it, and the
 * success message says the details are awaiting review (never "verified").
 */
export function BillingIdentityForm({ details, hasVerifiedOrReviewed }: { details: BillingIdentityDetailsView | null; hasVerifiedOrReviewed: boolean }) {
  const t = useTranslations("professional.billing");
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<SaveBillingIdentityInput>({
    resolver: useLocalizedZodResolver(saveBillingIdentitySchema),
    defaultValues: {
      entityType: details?.entityType ?? "INDIVIDUAL",
      legalName: details?.legalName ?? "",
      taxId: details?.taxId ?? "",
      taxCountry: details?.taxCountry ?? "ES",
      addressLine1: details?.addressLine1 ?? "",
      addressLine2: details?.addressLine2 ?? "",
      city: details?.city ?? "",
      region: details?.region ?? "",
      postalCode: details?.postalCode ?? "",
      country: details?.country ?? "ES",
    },
  });

  async function onSubmit(data: SaveBillingIdentityInput) {
    setServerError(null);
    setSaved(false);
    const result = await saveBillingIdentityAction(data);
    if (!result.success) {
      setServerError(result.error);
      for (const [field, messages] of Object.entries(result.fieldErrors ?? {})) {
        if (messages?.[0]) setError(field as keyof SaveBillingIdentityInput, { message: messages[0] });
      }
      return;
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-8" noValidate>
      {serverError && (
        <Alert variant="danger" role="alert">
          {serverError}
        </Alert>
      )}
      {saved && (
        <Alert variant="success" role="status">
          {t("form.saved")}
        </Alert>
      )}
      {hasVerifiedOrReviewed && <p className="text-sm text-foreground/70">{t("form.changeWarning")}</p>}

      <FormSection title={t("form.detailsSection")}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="entityType">
            {t("form.entityType")} <RequiredBadge />
          </Label>
          <Select id="entityType" invalid={!!errors.entityType} {...register("entityType")}>
            <option value="INDIVIDUAL">{t("form.entityTypes.INDIVIDUAL")}</option>
            <option value="COMPANY">{t("form.entityTypes.COMPANY")}</option>
          </Select>
          <FormFieldError>{errors.entityType?.message}</FormFieldError>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="legalName">
            {t("form.legalName")} <RequiredBadge />
          </Label>
          <Input id="legalName" autoComplete="organization" aria-invalid={!!errors.legalName} aria-describedby="legalName-hint" {...register("legalName")} />
          <p id="legalName-hint" className="text-xs text-foreground/60">{t("form.legalNameHint")}</p>
          <FormFieldError>{errors.legalName?.message}</FormFieldError>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="taxId">
              {t("form.taxId")} <RequiredBadge />
            </Label>
            <Input id="taxId" autoCapitalize="characters" spellCheck={false} aria-invalid={!!errors.taxId} aria-describedby="taxId-hint" {...register("taxId")} />
            <p id="taxId-hint" className="text-xs text-foreground/60">{t("form.taxIdHint")}</p>
            <FormFieldError>{errors.taxId?.message}</FormFieldError>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="taxCountry">
              {t("form.taxCountry")} <RequiredBadge />
            </Label>
            <Input id="taxCountry" maxLength={2} autoCapitalize="characters" spellCheck={false} aria-invalid={!!errors.taxCountry} aria-describedby="taxCountry-hint" {...register("taxCountry")} />
            <p id="taxCountry-hint" className="text-xs text-foreground/60">{t("form.countryHint")}</p>
            <FormFieldError>{errors.taxCountry?.message}</FormFieldError>
          </div>
        </div>
      </FormSection>

      <FormSection title={t("form.addressSection")}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="addressLine1">
            {t("form.addressLine1")} <RequiredBadge />
          </Label>
          <Input id="addressLine1" autoComplete="address-line1" aria-invalid={!!errors.addressLine1} {...register("addressLine1")} />
          <FormFieldError>{errors.addressLine1?.message}</FormFieldError>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="addressLine2">
            {t("form.addressLine2")} <OptionalBadge />
          </Label>
          <Input id="addressLine2" autoComplete="address-line2" aria-invalid={!!errors.addressLine2} {...register("addressLine2")} />
          <FormFieldError>{errors.addressLine2?.message}</FormFieldError>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="postalCode">
              {t("form.postalCode")} <RequiredBadge />
            </Label>
            <Input id="postalCode" autoComplete="postal-code" aria-invalid={!!errors.postalCode} {...register("postalCode")} />
            <FormFieldError>{errors.postalCode?.message}</FormFieldError>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="city">
              {t("form.city")} <RequiredBadge />
            </Label>
            <Input id="city" autoComplete="address-level2" aria-invalid={!!errors.city} {...register("city")} />
            <FormFieldError>{errors.city?.message}</FormFieldError>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="region">
              {t("form.region")} <OptionalBadge />
            </Label>
            <Input id="region" autoComplete="address-level1" aria-invalid={!!errors.region} {...register("region")} />
            <FormFieldError>{errors.region?.message}</FormFieldError>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="country">
              {t("form.country")} <RequiredBadge />
            </Label>
            <Input id="country" maxLength={2} autoCapitalize="characters" spellCheck={false} autoComplete="country" aria-invalid={!!errors.country} aria-describedby="country-hint" {...register("country")} />
            <p id="country-hint" className="text-xs text-foreground/60">{t("form.countryHint")}</p>
            <FormFieldError>{errors.country?.message}</FormFieldError>
          </div>
        </div>
      </FormSection>

      <FormActions stickyOnMobile>
        <Button type="submit" disabled={isSubmitting} className="sm:min-w-48">
          {isSubmitting ? t("form.saving") : t("form.save")}
        </Button>
      </FormActions>
    </form>
  );
}
