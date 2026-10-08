"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRef, useState } from "react";
import { useForm, type Resolver } from "react-hook-form";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { SuccessState } from "@/components/ui/success-state";
import { Textarea } from "@/components/ui/textarea";
import { FormActions } from "@/components/forms/form-actions";
import { FormFieldDescription, FormFieldError } from "@/components/forms/form-field-description";
import { FormSection } from "@/components/forms/form-section";
import { OptionalBadge, RequiredBadge } from "@/components/forms/field-badges";
import { useLocalizedZodResolver } from "@/hooks/use-localized-errors";
import { leadRequestSchema, type LeadRequestFormValues } from "@/application/dto/lead-request.dto";
import { submitLeadRequestAction } from "./actions";

interface CategoryOption {
  id: string;
  name: string;
}

/**
 * Module 142 — customer LEAD_V1 request form. Presentation only: it submits
 * the form values to `submitLeadRequestAction` and renders the customer-safe
 * outcome. Identity, flow version, category support, pricing and publication
 * are all decided on the server; nothing of that is (or could be) sent from
 * here. Categories arrive already filtered by the backend.
 */
export function LeadRequestForm({ categories }: { categories: CategoryOption[] }) {
  const t = useTranslations("customer.requests.leadForm");
  const tJobs = useTranslations("jobs");
  const [serverError, setServerError] = useState<{ message: string; signIn: boolean } | null>(null);
  const [submitted, setSubmitted] = useState(false);
  // Synchronous guard: `isSubmitting` only flips after React re-renders, so a
  // fast double tap could still fire twice. This is UX protection only — the
  // server-side rate limit remains the authoritative abuse control.
  const inFlight = useRef(false);

  const resolver = useLocalizedZodResolver(leadRequestSchema) as unknown as Resolver<LeadRequestFormValues>;
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LeadRequestFormValues>({
    resolver,
    defaultValues: {
      categoryId: "",
      title: "",
      description: "",
      urgency: "MEDIUM",
      location: { line1: "", line2: "", city: "", province: "", postalCode: "", country: "ES" },
    },
  });

  async function onSubmit(data: LeadRequestFormValues) {
    if (inFlight.current) return;
    inFlight.current = true;
    setServerError(null);
    try {
      const result = await submitLeadRequestAction(data);
      if (result.success) {
        setSubmitted(true);
        return;
      }
      setServerError({ message: result.error, signIn: result.code === "UNAUTHENTICATED" });
      for (const [field, messages] of Object.entries(result.fieldErrors ?? {})) {
        if (messages?.[0]) setError(field as Parameters<typeof setError>[0], { message: messages[0] });
      }
    } catch {
      // Network / framework failure: never surface internals.
      setServerError({ message: t("errors.submitFailed"), signIn: false });
    } finally {
      inFlight.current = false;
    }
  }

  if (submitted) {
    return (
      <div role="status" className="flex flex-col gap-4">
        <SuccessState
          title={t("success.title")}
          description={t("success.description")}
          action={
            <div className="flex flex-col items-center gap-3">
              <p className="max-w-sm text-sm text-muted-foreground">{t("success.noPaymentNote")}</p>
              <ButtonLink href="/requests">{t("success.viewRequests")}</ButtonLink>
            </div>
          }
        />
      </div>
    );
  }

  if (categories.length === 0) {
    return (
      <Alert variant="info" role="status">
        <div className="flex flex-col gap-1">
          <p className="font-medium">{t("unavailable.title")}</p>
          <p>{t("unavailable.description")}</p>
        </div>
      </Alert>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-8" noValidate aria-busy={isSubmitting}>
      {serverError && (
        <Alert variant="danger" role="alert">
          <span>
            {serverError.message}
            {serverError.signIn && (
              <>
                {" "}
                <Link href="/auth/login" className="font-medium underline">
                  {t("errors.signIn")}
                </Link>
              </>
            )}
          </span>
        </Alert>
      )}

      <FormSection title={t("sections.job")} description={t("sections.jobDescription")}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="categoryId">
            {t("fields.category")} <RequiredBadge />
          </Label>
          <Select
            id="categoryId"
            aria-invalid={!!errors.categoryId}
            aria-describedby={errors.categoryId ? "categoryId-error" : undefined}
            {...register("categoryId")}
          >
            <option value="">{t("fields.selectCategory")}</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
          <FormFieldError id="categoryId-error">{errors.categoryId?.message}</FormFieldError>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="title">
            {t("fields.title")} <RequiredBadge />
          </Label>
          <Input
            id="title"
            placeholder={t("fields.titlePlaceholder")}
            aria-invalid={!!errors.title}
            aria-describedby={errors.title ? "title-error" : undefined}
            {...register("title")}
          />
          <FormFieldError id="title-error">{errors.title?.message}</FormFieldError>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="description">
            {t("fields.description")} <RequiredBadge />
          </Label>
          <Textarea
            id="description"
            rows={6}
            placeholder={t("fields.descriptionPlaceholder")}
            aria-invalid={!!errors.description}
            aria-describedby={["description-hint", errors.description ? "description-error" : null].filter(Boolean).join(" ")}
            {...register("description")}
          />
          <FormFieldDescription id="description-hint">{t("fields.descriptionHint")}</FormFieldDescription>
          <FormFieldError id="description-error">{errors.description?.message}</FormFieldError>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="urgency">
            {t("fields.urgency")} <OptionalBadge />
          </Label>
          <Select id="urgency" className="sm:max-w-xs" {...register("urgency")}>
            <option value="LOW">{tJobs("urgency.LOW")}</option>
            <option value="MEDIUM">{tJobs("urgency.MEDIUM")}</option>
            <option value="HIGH">{tJobs("urgency.HIGH")}</option>
            <option value="EMERGENCY">{tJobs("urgency.EMERGENCY")}</option>
          </Select>
        </div>
      </FormSection>

      <FormSection title={t("sections.location")} description={t("sections.locationDescription")}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="location.line1">
            {t("fields.line1")} <RequiredBadge />
          </Label>
          <Input
            id="location.line1"
            autoComplete="address-line1"
            aria-invalid={!!errors.location?.line1}
            aria-describedby={errors.location?.line1 ? "line1-error" : undefined}
            {...register("location.line1")}
          />
          <FormFieldError id="line1-error">{errors.location?.line1?.message}</FormFieldError>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="location.line2">
            {t("fields.line2")} <OptionalBadge />
          </Label>
          <Input id="location.line2" autoComplete="address-line2" {...register("location.line2")} />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="location.city">
              {t("fields.city")} <RequiredBadge />
            </Label>
            <Input
              id="location.city"
              autoComplete="address-level2"
              aria-invalid={!!errors.location?.city}
              aria-describedby={errors.location?.city ? "city-error" : undefined}
              {...register("location.city")}
            />
            <FormFieldError id="city-error">{errors.location?.city?.message}</FormFieldError>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="location.postalCode">
              {t("fields.postalCode")} <RequiredBadge />
            </Label>
            <Input
              id="location.postalCode"
              autoComplete="postal-code"
              inputMode="numeric"
              aria-invalid={!!errors.location?.postalCode}
              aria-describedby={errors.location?.postalCode ? "postalCode-error" : undefined}
              {...register("location.postalCode")}
            />
            <FormFieldError id="postalCode-error">{errors.location?.postalCode?.message}</FormFieldError>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="location.province">
              {t("fields.province")} <OptionalBadge />
            </Label>
            <Input id="location.province" autoComplete="address-level1" {...register("location.province")} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="location.country">
              {t("fields.country")} <RequiredBadge />
            </Label>
            <Input
              id="location.country"
              autoComplete="country"
              aria-invalid={!!errors.location?.country}
              aria-describedby={errors.location?.country ? "country-error" : undefined}
              {...register("location.country")}
            />
            <FormFieldError id="country-error">{errors.location?.country?.message}</FormFieldError>
          </div>
        </div>
      </FormSection>

      <FormActions stickyOnMobile>
        <Button type="submit" disabled={isSubmitting} aria-disabled={isSubmitting} className="sm:min-w-48">
          {isSubmitting ? t("submitting") : t("submit")}
        </Button>
      </FormActions>
    </form>
  );
}
