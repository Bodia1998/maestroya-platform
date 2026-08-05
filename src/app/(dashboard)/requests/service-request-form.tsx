"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { MapPin } from "lucide-react";
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
  const isEditing = mode === "edit";
  const [serverError, setServerError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const schema = isEditing ? updateServiceRequestSchema : createServiceRequestSchema;

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
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
      setSuccessMessage("Service request updated.");
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

      <FormSection title="The job">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="categoryId">
            Service category <RequiredBadge />
          </Label>
          <Select
            id="categoryId"
            aria-invalid={!!errors.categoryId}
            aria-describedby={errors.categoryId ? "categoryId-error" : undefined}
            {...register("categoryId")}
          >
            <option value="">Select a category</option>
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
            Title <RequiredBadge />
          </Label>
          <Input
            id="title"
            placeholder="e.g. Fix leaking kitchen tap"
            aria-invalid={!!errors.title}
            aria-describedby={errors.title ? "title-error" : undefined}
            {...register("title")}
          />
          <FormFieldError id="title-error">{errors.title?.message}</FormFieldError>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="description">
            Description <RequiredBadge />
          </Label>
          <Textarea
            id="description"
            rows={5}
            placeholder="Describe the job in detail — what needs doing, any relevant context."
            aria-invalid={!!errors.description}
            aria-describedby={errors.description ? "description-error" : undefined}
            {...register("description")}
          />
          <FormFieldError id="description-error">{errors.description?.message}</FormFieldError>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="urgency">
            Urgency <RequiredBadge />
          </Label>
          <Select
            id="urgency"
            className="sm:max-w-xs"
            aria-invalid={!!errors.urgency}
            aria-describedby={errors.urgency ? "urgency-error" : undefined}
            {...register("urgency")}
          >
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
            <option value="EMERGENCY">Emergency</option>
          </Select>
          <FormFieldError id="urgency-error">{errors.urgency?.message}</FormFieldError>
        </div>
      </FormSection>

      <FormSection title="Budget" description="Give professionals a ballpark so quotes come in on target.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="budgetMin">
              Budget min (EUR) <OptionalBadge />
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
              Budget max (EUR) <OptionalBadge />
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

      <FormSection title="Job location" titleAside={<RequiredBadge />}>
        <fieldset className="flex flex-col gap-3 rounded-lg border border-border p-4">
          <legend className="flex items-center gap-1.5 px-1 text-sm font-medium text-foreground">
            <MapPin aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
            Address
          </legend>
          <div className="flex flex-col gap-1.5">
            <Input placeholder="Street address" aria-invalid={!!errors.location?.line1} {...register("location.line1")} />
            <FormFieldError>{errors.location?.line1?.message}</FormFieldError>
          </div>
          <Input placeholder="Apartment, floor, etc. (optional)" {...register("location.line2")} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input placeholder="City" aria-invalid={!!errors.location?.city} {...register("location.city")} />
            <Input placeholder="Postal code" {...register("location.postalCode")} />
          </div>
          <FormFieldError>{errors.location?.city?.message}</FormFieldError>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input placeholder="Province" {...register("location.province")} />
            <Input placeholder="Country" {...register("location.country")} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input type="number" step="any" placeholder="Latitude (optional)" {...register("location.latitude")} />
            <Input type="number" step="any" placeholder="Longitude (optional)" {...register("location.longitude")} />
          </div>
          <FormFieldError>{errors.location?.latitude?.message}</FormFieldError>
          <FormFieldError>{errors.location?.longitude?.message}</FormFieldError>
          <FormFieldDescription>
            Latitude/longitude are filled in automatically where possible — leave blank if unsure.
          </FormFieldDescription>
        </fieldset>
      </FormSection>

      <FormActions stickyOnMobile>
        <Button type="submit" disabled={isSubmitting} className="sm:min-w-48">
          {isSubmitting ? "Saving…" : isEditing ? "Save changes" : "Post request"}
        </Button>
      </FormActions>
    </form>
  );
}
