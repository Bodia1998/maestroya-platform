import { z } from "zod";

import { SUPPORTED_LOCALES } from "@/shared/i18n/locales";

/**
 * Module 29 — Internationalization: the DTO for the language-preference
 * endpoint. Same convention as every other `*.dto.ts` here — one schema
 * shared by the client and by the server entry point that receives it.
 *
 * Note there is no prose in this file. The only user-facing message it
 * could carry ("pick a supported language") would be a hardcoded English
 * string in the application layer, which is exactly what this module
 * exists to eliminate — the route resolves issues through the
 * `validation` namespace instead (see
 * src/shared/i18n/validation-messages.ts).
 *
 * `z.enum` is built from `SUPPORTED_LOCALES` rather than restating the
 * list, so adding a language really is a one-line change in
 * locales.ts + translation files: the API's accepted values follow
 * automatically, and it is impossible for the endpoint to accept a code
 * the app ships no messages for.
 */
export const localeSchema = z.enum(SUPPORTED_LOCALES);

export const updateLanguagePreferenceSchema = z.object({
  locale: localeSchema,
});

export type UpdateLanguagePreferenceInput = z.infer<typeof updateLanguagePreferenceSchema>;
