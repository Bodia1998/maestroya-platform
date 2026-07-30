"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
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
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
      {serverError && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {serverError}
        </p>
      )}

      <div className="flex flex-col gap-3 rounded-md border border-border p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Items</h3>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => append({ description: "", quantity: 1, unitPrice: 0, category: "LABOR" })}
          >
            Add item
          </Button>
        </div>

        {fields.map((field, index) => (
          <div key={field.id} className="grid grid-cols-[1fr_5rem_6rem_7rem_2rem] items-start gap-2">
            <div className="flex flex-col gap-1">
              <input
                className="h-10 rounded-md border border-border px-3 text-sm"
                placeholder="Description (e.g. Labor, materials)"
                {...register(`items.${index}.description` as const)}
              />
              {errors.items?.[index]?.description && (
                <p className="text-xs text-red-600">{errors.items[index]?.description?.message}</p>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <input
                type="number"
                step="any"
                min={0}
                className="h-10 rounded-md border border-border px-3 text-sm"
                placeholder="Qty"
                {...register(`items.${index}.quantity` as const)}
              />
              {errors.items?.[index]?.quantity && (
                <p className="text-xs text-red-600">{errors.items[index]?.quantity?.message}</p>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <input
                type="number"
                step="0.01"
                min={0}
                className="h-10 rounded-md border border-border px-3 text-sm"
                placeholder="Unit €"
                {...register(`items.${index}.unitPrice` as const)}
              />
              {errors.items?.[index]?.unitPrice && (
                <p className="text-xs text-red-600">{errors.items[index]?.unitPrice?.message}</p>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <select
                className="h-10 rounded-md border border-border px-2 text-sm"
                aria-label="Item type"
                {...register(`items.${index}.category` as const)}
              >
                <option value="LABOR">Labor</option>
                <option value="MATERIALS">Materials</option>
              </select>
              {errors.items?.[index]?.category && (
                <p className="text-xs text-red-600">{errors.items[index]?.category?.message}</p>
              )}
            </div>
            <button
              type="button"
              className="h-10 rounded-md text-sm text-red-600 hover:bg-red-50 disabled:opacity-40"
              disabled={fields.length <= 1}
              onClick={() => remove(index)}
              aria-label="Remove item"
            >
              ✕
            </button>
          </div>
        ))}
        {errors.items?.message && <p className="text-xs text-red-600">{errors.items.message}</p>}

        <p className="text-right text-sm font-medium">
          Estimated total: €{estimatedTotal.toFixed(2)}
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="notes" className="text-sm font-medium">
          Notes / proposal (optional)
        </label>
        <textarea
          id="notes"
          rows={4}
          placeholder="Describe your proposal, timeline, or anything the customer should know."
          className="rounded-md border border-border px-3 py-2 text-sm"
          {...register("notes")}
        />
        {errors.notes && <p className="text-xs text-red-600">{errors.notes.message}</p>}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="validUntil" className="text-sm font-medium">
          Valid until (optional)
        </label>
        <input
          id="validUntil"
          type="date"
          defaultValue={toDateInputValue(quote?.validUntil ?? null)}
          className="h-10 rounded-md border border-border px-3 text-sm"
          {...register("validUntil")}
        />
        {errors.validUntil && <p className="text-xs text-red-600">{errors.validUntil.message}</p>}
      </div>

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Saving…" : isEditing ? "Save changes" : "Create quote"}
      </Button>
    </form>
  );
}
