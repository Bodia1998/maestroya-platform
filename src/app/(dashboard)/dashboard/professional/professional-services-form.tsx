"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormActions } from "@/components/forms/form-actions";
import { FormFieldError } from "@/components/forms/form-field-description";
import { FormSection } from "@/components/forms/form-section";
import {
  updateProfessionalServicesSchema,
  type UpdateProfessionalServicesInput,
} from "@/application/dto/professional.dto";
import { updateProfessionalServicesAction } from "./actions";

interface CategoryOption {
  id: string;
  name: string;
}

export function ProfessionalServicesForm({
  categories,
  selectedCategoryIds,
}: {
  categories: CategoryOption[];
  selectedCategoryIds: string[];
}) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<UpdateProfessionalServicesInput>({
    resolver: zodResolver(updateProfessionalServicesSchema),
    defaultValues: { categoryIds: selectedCategoryIds },
  });

  async function onSubmit(data: UpdateProfessionalServicesInput) {
    setServerError(null);
    setSuccessMessage(null);
    const result = await updateProfessionalServicesAction(data);

    if (!result.success) {
      setServerError(result.error);
      return;
    }
    setSuccessMessage("Service categories updated.");
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-6" noValidate>
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

      <FormSection title="Service categories" description="Customers find you by these categories — pick every one that applies.">
        <fieldset className="grid grid-cols-1 gap-2 rounded-lg border border-border p-4 sm:grid-cols-2">
          <legend className="sr-only">Service categories</legend>
          {categories.map((category) => (
            <label key={category.id} className="flex min-h-11 items-center gap-2 rounded-md px-1 text-sm text-foreground">
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
        </fieldset>
        <FormFieldError>{errors.categoryIds?.message}</FormFieldError>
      </FormSection>

      <FormActions stickyOnMobile>
        <Button type="submit" disabled={isSubmitting} className="sm:min-w-48">
          {isSubmitting ? "Saving…" : "Save service categories"}
        </Button>
      </FormActions>
    </form>
  );
}
