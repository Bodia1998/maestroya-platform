"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useCallback, useMemo } from "react";
import type { FieldErrors, FieldValues, Resolver } from "react-hook-form";
import type { z } from "zod";

import { localizeError } from "@/presentation/i18n/error-messages";
import {
  createTranslatedErrorMap,
  translateValidationMessage,
  type Translator,
} from "@/shared/i18n/validation-messages";

/**
 * Module 120 — Multilingual Localization: client-side counterparts of
 * `@/presentation/i18n/server`.
 *
 * ## `useLocalizedZodResolver(schema)`
 *
 * Drop-in replacement for `zodResolver(schema)` in `useForm({ resolver })`.
 * It (1) installs the locale-bound Zod error map, so built-in issues
 * ("required", "too short", "invalid email") come back localised, and
 * (2) translates schema-authored messages that are validation *keys*
 * (`"required"`, `"dto.quote.itemsRequired"`), which Zod returns verbatim
 * without consulting any error map. Schema prose (pre-migration DTOs) is
 * passed through unchanged.
 */
export function useLocalizedZodResolver<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
): Resolver<z.infer<TSchema>> {
  const t = useTranslations("validation") as unknown as Translator;
  return useMemo(() => {
    const base = zodResolver(schema, { errorMap: createTranslatedErrorMap(t) });
    const resolver: Resolver<z.infer<TSchema>> = async (values, context, options) => {
      const result = await base(values, context, options);
      translateErrorTree(result.errors as FieldErrors<FieldValues>, t);
      return result as Awaited<ReturnType<Resolver<z.infer<TSchema>>>>;
    };
    return resolver;
  }, [schema, t]);
}

function translateErrorTree(errors: FieldErrors<FieldValues> | undefined, t: Translator): void {
  if (!errors) return;
  for (const [key, value] of Object.entries(errors)) {
    // `ref` is the registered DOM element (walking it would walk React's
    // fiber tree); `types` only exists with `criteriaMode: "all"`.
    if (key === "ref" || key === "types") continue;
    if (!value || typeof value !== "object") continue;
    const node = value as { message?: unknown };
    if (typeof node.message === "string") {
      node.message = translateValidationMessage(t, node.message);
    }
    translateErrorTree(value as FieldErrors<FieldValues>, t);
  }
}

/**
 * `(error, fallback?) => string` in the current locale — for Client
 * Components that catch errors themselves (fetch failures, thrown
 * results). `fallback` should already be localised by the caller.
 */
export function useErrorLocalizer(): (error: unknown, fallback?: string) => string {
  const t = useTranslations("errors") as unknown as Translator;
  return useCallback(
    (error: unknown, fallback?: string) => localizeError(t, error, { fallback }),
    [t],
  );
}
