"use client";

import { MapPin } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormActions } from "@/components/forms/form-actions";
import { FormFieldDescription, FormFieldError } from "@/components/forms/form-field-description";
import { FormSection } from "@/components/forms/form-section";
import { OptionalBadge, RequiredBadge } from "@/components/forms/field-badges";
import { useLocalizedZodResolver } from "@/hooks/use-localized-errors";
import {
  createServiceRequestSchema,
  updateServiceRequestSchema,
  type CreateServiceRequestInput,
  type UpdateServiceRequestInput,
} from "@/application/dto/service-request.dto";
import { createServiceRequestAction, updateServiceRequestAction } from "./actions";

interface CategoryOption {
  id: string;
  name: string;
}

interface ServiceRequestLike {
  id: string;
  categoryId: string;
  title: string;
  description: string;
  urgency: string;
  budgetMin: number | null;
  budgetMax: number | null;
  location: {
    line1: string;
    line2: string | null;
    city: string;
    province: string | null;
    postalCode: string;
    country: string;
    latitude: number | null;
    longitude: number | null;
  };
}

type FormValues = CreateServiceRequestInput | UpdateServiceRequestInput;

/**
 * Handles both "create a new request" and "edit an open request" with the
 * same field set, mirroring how ProfessionalProfileForm is one component
 * for create+edit rather than two near-duplicates. Only ever rendered for
 * a request in the OPEN-equivalent (PUBLISHED) state when editing — the
 * page that renders this in edit mode is responsible for that check (see
 * requests/[id]/edit/page.tsx), and UpdateServiceRequestUseCase enforces it
 * again server-side regardless.
 */
export function ServiceRequestForm({
  mode,
  categories,
  request,
  prefill,
}: {
  mode: "create" | "edit";
  categories: CategoryOption[];
  request: ServiceRequestLike | null;
  /**
   * Optional starting values for a brand-new request — used when a
   * customer arrives here via "Request this service" on a public
   * professional profile (see (marketing)/professionals/[id]/page.tsx),
   * so the category/city they were already looking at doesn't have to be
   * re-entered. Deliberately just a form prefill, nothing more: the
   * customer still reviews/edits every field and submits through the
   * exact same `createServiceRequestAction` as any other new request —
   * this professional has no special claim on the resulting request, it's
   * discovered like any other PUBLISHED request (see
   * CreateServiceRequestUseCase's own doc comment on why there is no
   * "targeted at one professional" concept in this domain model). Ignored
   * in "edit" mode.
   */
  prefill?: { categoryId?: string; city?: string };
}) {
  const router = useRouter();
  const t = useTranslations("customer.requests.form");
  const tCommon = useTranslations("common");
  const tJobs = useTranslations("jobs");
  const isEditing = mode === "edit";
  const [serverError, setServerError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const schema = isEditing ? updateServiceRequestSchema : createServiceRequestSchema;
  const resolver = useLocalizedZodResolver(schema);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver,
    defaultValues: {
      categoryId: request?.categoryId ?? prefill?.categoryId ?? "",
      title: request?.title ?? "",
      description: request?.description ?? "",
      urgency: (request?.urgency as FormValues["urgency"]) ?? "MEDIUM",
      budgetMin: request?.budgetMin ?? undefined,
      budgetMax: request?.budgetMax ?? undefined,
      location: request
        ? {
            line1: request.location.line1,
            line2: request.location.line2 ?? "",
            city: request.location.city,
            province: request.location.province ?? "",
            postalCode: request.location.postalCode,
            country: request.location.country,
            latitude: request.location.latitude ?? undefined,
            longitude: request.location.longitude ?? undefined,
          }
        : { line1: "", city: prefill?.city ?? "", postalCode: "", country: "ES" },
    },
  });

  async function onSubmit(data: FormValues) {
    setServerError(null);
    setSuccessMessage(null);

    if (isEditing && request) {
      const result = await updateServiceRequestAction(request.id, data);
      if (!result.success) {
        setServerError(result.error);
        if (result.fieldErrors) {
          for (const [field, messages] of Object.entries(result.fieldErrors)) {
            if (messages?.[0]) {
              setError(field as keyof FormValues, { message: messages[0] });
            }
          }
        }
        return;
      }
      setSuccessMessage(t("updated"));
      router.refresh();
      return;
    }

    const result = await createServiceRequestAction(data);
    if (!result.success) {
      setServerError(result.error);
      if (result.fieldErrors) {
        for (const [field, messages] of Object.entries(result.fieldErrors)) {
          if (messages?.[0]) {
            setError(field as keyof FormValues, { message: messages[0] });
          }
        }
      }
      return;
    }

    router.push(`/requests/${result.id}`);
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-8" noValidate>
      {serverError && (
        <Alert variant="danger" role="alert">
          {serverError}
        </Alert>
      )}
      {successMessage && (
        <Alert variant="success" role="status">
          {successMessage}
        </Alert>
      )}

      <FormSection title={t("sections.job")}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="categoryId">
            {t("category")} <RequiredBadge />
          </Label>
          <Select
            id="categoryId"
            aria-invalid={!!errors.categoryId}
            aria-describedby={errors.categoryId ? "categoryId-error" : undefined}
            {...register("categoryId")}
          >
            <option value="">{t("selectCategory")}</option>
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
            {t("title")} <RequiredBadge />
          </Label>
          <Input
            id="title"
            placeholder={t("titlePlaceholder")}
            aria-invalid={!!errors.title}
            aria-describedby={errors.title ? "title-error" : undefined}
            {...register("title")}
          />
          <FormFieldError id="title-error">{errors.title?.message}</FormFieldError>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="description">
            {t("description")} <RequiredBadge />
          </Label>
          <Textarea
            id="description"
            rows={5}
            placeholder={t("descriptionPlaceholder")}
            aria-invalid={!!errors.description}
            aria-describedby={errors.description ? "description-error" : undefined}
            {...register("description")}
          />
          <FormFieldError id="description-error">{errors.description?.message}</FormFieldError>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="urgency">
            {t("urgency")} <RequiredBadge />
          </Label>
          <Select
            id="urgency"
            className="sm:max-w-xs"
            aria-invalid={!!errors.urgency}
            aria-describedby={errors.urgency ? "urgency-error" : undefined}
            {...register("urgency")}
          >
            <option value="LOW">{tJobs("urgency.LOW")}</option>
            <option value="MEDIUM">{tJobs("urgency.MEDIUM")}</option>
            <option value="HIGH">{tJobs("urgency.HIGH")}</option>
            <option value="EMERGENCY">{tJobs("urgency.EMERGENCY")}</option>
          </Select>
          <FormFieldError id="urgency-error">{errors.urgency?.message}</FormFieldError>
        </div>
      </FormSection>

      <FormSection title={t("sections.budget")} description={t("sections.budgetDescription")}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="budgetMin">
              {t("budgetMin")} <OptionalBadge />
            </Label>
            <Input
              id="budgetMin"
              type="number"
              min={0}
              step="0.01"
              aria-invalid={!!errors.budgetMin}
              aria-describedby={errors.budgetMin ? "budgetMin-error" : undefined}
              {...register("budgetMin")}
            />
            <FormFieldError id="budgetMin-error">{errors.budgetMin?.message}</FormFieldError>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="budgetMax">
              {t("budgetMax")} <OptionalBadge />
            </Label>
            <Input
              id="budgetMax"
              type="number"
              min={0}
              step="0.01"
              aria-invalid={!!errors.budgetMax}
              aria-describedby={errors.budgetMax ? "budgetMax-error" : undefined}
              {...register("budgetMax")}
            />
            <FormFieldError id="budgetMax-error">{errors.budgetMax?.message}</FormFieldError>
          </div>
        </div>
      </FormSection>

      <FormSection title={t("sections.location")} titleAside={<RequiredBadge />}>
        <fieldset className="flex flex-col gap-3 rounded-lg border border-border p-4">
          <legend className="flex items-center gap-1.5 px-1 text-sm font-medium text-foreground">
            <MapPin aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
            {t("address")}
          </legend>
          <div className="flex flex-col gap-1.5">
            <Input placeholder={t("streetPlaceholder")} aria-invalid={!!errors.location?.line1} {...register("location.line1")} />
            <FormFieldError>{errors.location?.line1?.message}</FormFieldError>
          </div>
          <Input placeholder={t("line2Placeholder")} {...register("location.line2")} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input placeholder={t("cityPlaceholder")} aria-invalid={!!errors.location?.city} {...register("location.city")} />
            <Input placeholder={t("postalCodePlaceholder")} {...register("location.postalCode")} />
          </div>
          <FormFieldError>{errors.location?.city?.message}</FormFieldError>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input placeholder={t("provincePlaceholder")} {...register("location.province")} />
            <Input placeholder={t("countryPlaceholder")} {...register("location.country")} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input type="number" step="any" placeholder={t("latitudePlaceholder")} {...register("location.latitude")} />
            <Input type="number" step="any" placeholder={t("longitudePlaceholder")} {...register("location.longitude")} />
          </div>
          <FormFieldError>{errors.location?.latitude?.message}</FormFieldError>
          <FormFieldError>{errors.location?.longitude?.message}</FormFieldError>
          <FormFieldDescription>
            {t("coordinatesHelp")}
          </FormFieldDescription>
        </fieldset>
      </FormSection>

      <FormActions stickyOnMobile>
        <Button type="submit" disabled={isSubmitting} className="sm:min-w-48">
          {isSubmitting ? tCommon("states.saving") : isEditing ? t("saveChanges") : t("postRequest")}
        </Button>
      </FormActions>
    </form>
  );
}
