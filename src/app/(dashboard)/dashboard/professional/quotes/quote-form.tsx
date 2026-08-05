"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormActions } from "@/components/forms/form-actions";
import { FormFieldError } from "@/components/forms/form-field-description";
import { FormSection } from "@/components/forms/form-section";
import { OptionalBadge } from "@/components/forms/field-badges";
import {
  createQuoteSchema,
  updateQuoteSchema,
  type CreateQuoteInput,
  type UpdateQuoteInput,
} from "@/application/dto/quote.dto";
import { createQuoteAction, updateQuoteAction } from "./actions";

interface QuoteItemLike {
  description: string;
  quantity: number;
  unitPrice: number;
  category?: "LABOR" | "MATERIALS";
}

interface QuoteLike {
  id: string;
  notes: string | null;
  validUntil: Date | null;
  items: QuoteItemLike[];
}

type FormValues = CreateQuoteInput | UpdateQuoteInput;

function toDateInputValue(date: Date | null): string {
  if (!date) return "";
  return date.toISOString().slice(0, 10);
}

/**
 * Handles both "submit a new quote for an eligible request" and "edit an
 * editable (SENT/VIEWED) quote" with the same field set, mirroring how
 * ServiceRequestForm is one component for create+edit rather than two
 * near-duplicates. `totalAmount` is never a field here — it's always
 * calculated server-side from `items` (see money.ts) and shown read-only
 * once the quote exists.
 */
export function QuoteForm({
  mode,
  requestId,
  quote,
}: {
  mode: "create" | "edit";
  requestId?: string;
  quote: QuoteLike | null;
}) {
  const router = useRouter();
  const isEditing = mode === "edit";
  const [serverError, setServerError] = useState<string | null>(null);

  const schema = isEditing ? updateQuoteSchema : createQuoteSchema;

  const {
    register,
    control,
    handleSubmit,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      ...(isEditing ? {} : { serviceRequestId: requestId ?? "" }),
      notes: quote?.notes ?? "",
      validUntil: quote?.validUntil ?? undefined,
      items: quote && quote.items.length > 0
        ? quote.items.map((item) => ({
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            category: item.category ?? "LABOR",
          }))
        : [{ description: "", quantity: 1, unitPrice: 0, category: "LABOR" }],
    } as FormValues,
  });

  const { fields, append, remove } = useFieldArray({ control, name: "items" });
  const watchedItems = watch("items") ?? [];
  const estimatedTotal = watchedItems.reduce((sum, item) => {
    const quantity = Number(item?.quantity ?? 0);
    const unitPrice = Number(item?.unitPrice ?? 0);
    if (!Number.isFinite(quantity) || !Number.isFinite(unitPrice)) return sum;
    return sum + quantity * unitPrice;
  }, 0);

  async function onSubmit(data: FormValues) {
    setServerError(null);

    if (isEditing && quote) {
      const result = await updateQuoteAction(quote.id, data);
      if (!result.success) {
        setServerError(result.error);
        if (result.fieldErrors) {
          for (const [field, messages] of Object.entries(result.fieldErrors)) {
            if (messages?.[0]) setError(field as keyof FormValues, { message: messages[0] });
          }
        }
        return;
      }
      router.push(`/dashboard/professional/quotes/${quote.id}`);
      router.refresh();
      return;
    }

    if (!requestId) return;
    const result = await createQuoteAction(requestId, data);
    if (!result.success) {
      setServerError(result.error);
      if (result.fieldErrors) {
        for (const [field, messages] of Object.entries(result.fieldErrors)) {
          if (messages?.[0]) setError(field as keyof FormValues, { message: messages[0] });
        }
      }
      return;
    }
    router.push(`/dashboard/professional/quotes/${result.id}`);
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-8" noValidate>
      {serverError && (
        <Alert variant="danger" role="alert">
          {serverError}
        </Alert>
      )}

      <FormSection title="Items" description="Break down labor and materials so the customer sees exactly what they're paying for.">
        <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
          <div className="flex items-center justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => append({ description: "", quantity: 1, unitPrice: 0, category: "LABOR" })}
            >
              <Plus aria-hidden className="h-4 w-4" />
              Add item
            </Button>
          </div>

          <div className="flex flex-col gap-4">
            {fields.map((field, index) => (
              <div
                key={field.id}
                className="grid grid-cols-1 gap-2 border-b border-border pb-4 last:border-0 last:pb-0 sm:grid-cols-[1fr_5rem_6rem_7rem_2.5rem] sm:items-start"
              >
                <div className="flex flex-col gap-1">
                  <Label htmlFor={`item-${field.id}-description`} className="sm:sr-only">
                    Description
                  </Label>
                  <Input
                    id={`item-${field.id}-description`}
                    placeholder="Description (e.g. Labor, materials)"
                    aria-invalid={!!errors.items?.[index]?.description}
                    aria-describedby={
                      errors.items?.[index]?.description ? `item-${field.id}-description-error` : undefined
                    }
                    {...register(`items.${index}.description` as const)}
                  />
                  <FormFieldError id={`item-${field.id}-description-error`}>
                    {errors.items?.[index]?.description?.message}
                  </FormFieldError>
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor={`item-${field.id}-quantity`} className="sm:sr-only">
                    Quantity
                  </Label>
                  <Input
                    id={`item-${field.id}-quantity`}
                    type="number"
                    step="any"
                    min={0}
                    placeholder="Qty"
                    aria-invalid={!!errors.items?.[index]?.quantity}
                    aria-describedby={
                      errors.items?.[index]?.quantity ? `item-${field.id}-quantity-error` : undefined
                    }
                    {...register(`items.${index}.quantity` as const)}
                  />
                  <FormFieldError id={`item-${field.id}-quantity-error`}>
                    {errors.items?.[index]?.quantity?.message}
                  </FormFieldError>
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor={`item-${field.id}-unitPrice`} className="sm:sr-only">
                    Unit price
                  </Label>
                  <Input
                    id={`item-${field.id}-unitPrice`}
                    type="number"
                    step="0.01"
                    min={0}
                    placeholder="Unit €"
                    aria-invalid={!!errors.items?.[index]?.unitPrice}
                    aria-describedby={
                      errors.items?.[index]?.unitPrice ? `item-${field.id}-unitPrice-error` : undefined
                    }
                    {...register(`items.${index}.unitPrice` as const)}
                  />
                  <FormFieldError id={`item-${field.id}-unitPrice-error`}>
                    {errors.items?.[index]?.unitPrice?.message}
                  </FormFieldError>
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor={`item-${field.id}-category`} className="sm:sr-only">
                    Item type
                  </Label>
                  <Select
                    id={`item-${field.id}-category`}
                    aria-invalid={!!errors.items?.[index]?.category}
                    aria-describedby={
                      errors.items?.[index]?.category ? `item-${field.id}-category-error` : undefined
                    }
                    {...register(`items.${index}.category` as const)}
                  >
                    <option value="LABOR">Labor</option>
                    <option value="MATERIALS">Materials</option>
                  </Select>
                  <FormFieldError id={`item-${field.id}-category-error`}>
                    {errors.items?.[index]?.category?.message}
                  </FormFieldError>
                </div>
                <IconButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={fields.length <= 1}
                  onClick={() => remove(index)}
                  aria-label="Remove item"
                  className="justify-self-end text-danger hover:bg-danger-muted sm:justify-self-auto"
                >
                  <X aria-hidden className="h-4 w-4" />
                </IconButton>
              </div>
            ))}
          </div>
          <FormFieldError>{errors.items?.message as string | undefined}</FormFieldError>

          <p className="text-right text-sm font-medium text-foreground">
            Estimated total: €{estimatedTotal.toFixed(2)}
          </p>
        </div>
      </FormSection>

      <FormSection title="Details">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="notes">
            Notes / proposal <OptionalBadge />
          </Label>
          <Textarea
            id="notes"
            rows={4}
            placeholder="Describe your proposal, timeline, or anything the customer should know."
            aria-invalid={!!errors.notes}
            aria-describedby={errors.notes ? "notes-error" : undefined}
            {...register("notes")}
          />
          <FormFieldError id="notes-error">{errors.notes?.message}</FormFieldError>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="validUntil">
            Valid until <OptionalBadge />
          </Label>
          <Input
            id="validUntil"
            type="date"
            className="sm:max-w-xs"
            defaultValue={toDateInputValue(quote?.validUntil ?? null)}
            aria-invalid={!!errors.validUntil}
            aria-describedby={errors.validUntil ? "validUntil-error" : undefined}
            {...register("validUntil")}
          />
          <FormFieldError id="validUntil-error">{errors.validUntil?.message}</FormFieldError>
        </div>
      </FormSection>

      <FormActions stickyOnMobile>
        <Button type="submit" disabled={isSubmitting} className="sm:min-w-48">
          {isSubmitting ? "Saving…" : isEditing ? "Save changes" : "Create quote"}
        </Button>
      </FormActions>
    </form>
  );
}
