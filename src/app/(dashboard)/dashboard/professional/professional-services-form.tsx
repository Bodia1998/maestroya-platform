"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
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

      <div className="grid grid-cols-2 gap-2 rounded-md border border-border p-4">
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

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Saving…" : "Save service categories"}
      </Button>
    </form>
  );
}
