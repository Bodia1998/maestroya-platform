"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
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
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
      {serverError && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {serverError}
        </p>
      )}
      {successMessage && (
        <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
          {successMessage}
        </p>
      )}

      <div className="flex flex-col gap-1">
        <label htmlFor="categoryId" className="text-sm font-medium">
          Service category
        </label>
        <select
          id="categoryId"
          className="h-10 rounded-md border border-border px-3 text-sm"
          {...register("categoryId")}
        >
          <option value="">Select a category</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        {errors.categoryId && <p className="text-xs text-red-600">{errors.categoryId.message}</p>}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="title" className="text-sm font-medium">
          Title
        </label>
        <input
          id="title"
          placeholder="e.g. Fix leaking kitchen tap"
          className="h-10 rounded-md border border-border px-3 text-sm"
          {...register("title")}
        />
        {errors.title && <p className="text-xs text-red-600">{errors.title.message}</p>}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="description" className="text-sm font-medium">
          Description
        </label>
        <textarea
          id="description"
          rows={5}
          placeholder="Describe the job in detail — what needs doing, any relevant context."
          className="rounded-md border border-border px-3 py-2 text-sm"
          {...register("description")}
        />
        {errors.description && <p className="text-xs text-red-600">{errors.description.message}</p>}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="urgency" className="text-sm font-medium">
          Urgency
        </label>
        <select
          id="urgency"
          className="h-10 rounded-md border border-border px-3 text-sm"
          {...register("urgency")}
        >
          <option value="LOW">Low</option>
          <option value="MEDIUM">Medium</option>
          <option value="HIGH">High</option>
          <option value="EMERGENCY">Emergency</option>
        </select>
        {errors.urgency && <p className="text-xs text-red-600">{errors.urgency.message}</p>}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="budgetMin" className="text-sm font-medium">
            Budget min (EUR, optional)
          </label>
          <input
            id="budgetMin"
            type="number"
            min={0}
            step="0.01"
            className="h-10 rounded-md border border-border px-3 text-sm"
            {...register("budgetMin")}
          />
          {errors.budgetMin && <p className="text-xs text-red-600">{errors.budgetMin.message}</p>}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="budgetMax" className="text-sm font-medium">
            Budget max (EUR, optional)
          </label>
          <input
            id="budgetMax"
            type="number"
            min={0}
            step="0.01"
            className="h-10 rounded-md border border-border px-3 text-sm"
            {...register("budgetMax")}
          />
          {errors.budgetMax && <p className="text-xs text-red-600">{errors.budgetMax.message}</p>}
        </div>
      </div>

      <fieldset className="flex flex-col gap-3 rounded-md border border-border p-4">
        <legend className="px-1 text-sm font-medium">Job location</legend>
        <input
          className="h-10 rounded-md border border-border px-3 text-sm"
          placeholder="Street address"
          {...register("location.line1")}
        />
        {errors.location?.line1 && (
          <p className="text-xs text-red-600">{errors.location.line1.message}</p>
        )}
        <input
          className="h-10 rounded-md border border-border px-3 text-sm"
          placeholder="Apartment, floor, etc. (optional)"
          {...register("location.line2")}
        />
        <div className="grid grid-cols-2 gap-3">
          <input
            className="h-10 rounded-md border border-border px-3 text-sm"
            placeholder="City"
            {...register("location.city")}
          />
          <input
            className="h-10 rounded-md border border-border px-3 text-sm"
            placeholder="Postal code"
            {...register("location.postalCode")}
          />
        </div>
        {errors.location?.city && (
          <p className="text-xs text-red-600">{errors.location.city.message}</p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <input
            className="h-10 rounded-md border border-border px-3 text-sm"
            placeholder="Province"
            {...register("location.province")}
          />
          <input
            className="h-10 rounded-md border border-border px-3 text-sm"
            placeholder="Country"
            {...register("location.country")}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <input
            type="number"
            step="any"
            className="h-10 rounded-md border border-border px-3 text-sm"
            placeholder="Latitude (optional)"
            {...register("location.latitude")}
          />
          <input
            type="number"
            step="any"
            className="h-10 rounded-md border border-border px-3 text-sm"
            placeholder="Longitude (optional)"
            {...register("location.longitude")}
          />
        </div>
        {errors.location?.latitude && (
          <p className="text-xs text-red-600">{errors.location.latitude.message}</p>
        )}
        {errors.location?.longitude && (
          <p className="text-xs text-red-600">{errors.location.longitude.message}</p>
        )}
      </fieldset>

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Saving…" : isEditing ? "Save changes" : "Post request"}
      </Button>
    </form>
  );
}
