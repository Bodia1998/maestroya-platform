import { z } from "zod";

import type { Translator } from "@/shared/i18n/translator";

/**
 * Module 29 — Internationalization: translatable Zod validation messages.
 *
 * ## The rule this file enforces
 *
 * Validation schemas live in `src/core/application/dto/*` — the
 * application layer. They must not contain user-facing prose, because
 * prose is presentation and the application layer has no locale. What a
 * schema *may* carry is a **translation key**; the presentation layer
 * resolves it against the `validation` namespace at render time. Business
 * logic therefore stays language-agnostic and there is exactly one copy
 * of every validation rule, not one per language.
 *
 * ## The two supported patterns
 *
 * 1. **Key in the message slot** (explicit, per-field):
 *
 *    ```ts
 *    // in the DTO — no prose, just a key
 *    z.string().min(2, VALIDATION_KEYS.minLength)
 *    // at the edge (form / action)
 *    translateValidationMessage(t, issue.message, { min: 2 })
 *    ```
 *
 * 2. **A locale-bound error map** (implicit, whole-schema):
 *
 *    ```ts
 *    const result = parseWithTranslatedErrors(schema, input, t);
 *    ```
 *
 *    which installs `createTranslatedErrorMap(t)` for one parse call, so
 *    every issue Zod raises — including the built-in ones a schema never
 *    spelled out, like `invalid_type` on a missing field — comes back
 *    already localised, with no message strings in the DTO at all.
 *
 * Pattern 2 is the default for anything new. Pattern 1 exists because the
 * DTOs written before this module (auth.dto.ts, profile.dto.ts, …) carry
 * hardcoded English strings, and rewriting every one of them is a
 * migration this module deliberately does not perform in one shot — see
 * docs/MODULE_29_INTERNATIONALIZATION.md §10. `translateValidationMessage`
 * passes any string that is not a known key straight through, so those
 * schemas keep working untouched while new and migrated ones get
 * translated messages.
 */

export const VALIDATION_KEYS = {
  required: "required",
  email: "email",
  url: "url",
  minLength: "minLength",
  maxLength: "maxLength",
  tooSmall: "tooSmall",
  tooBig: "tooBig",
  number: "number",
  date: "date",
  phone: "phone",
  passwordTooWeak: "passwordTooWeak",
  mismatch: "mismatch",
  invalid: "invalid",
  summary: "summary",
} as const;

export type ValidationKey = (typeof VALIDATION_KEYS)[keyof typeof VALIDATION_KEYS];

const KNOWN_KEYS = new Set<string>(Object.values(VALIDATION_KEYS));

export function isValidationKey(value: string): value is ValidationKey {
  return KNOWN_KEYS.has(value);
}

/**
 * Resolve one message that may be either a translation key or an already
 * human-readable string. Pass-through for the latter is what makes this
 * safe to call on every existing DTO's output.
 */
export function translateValidationMessage(
  t: Translator,
  message: string,
  values?: Record<string, string | number>,
): string {
  return isValidationKey(message) ? t(message, values) : message;
}

/** Map a Zod issue onto a `validation` namespace key plus its ICU values. */
export function mapIssue(issue: z.ZodIssueOptionalMessage): {
  key: ValidationKey;
  values: Record<string, string | number>;
} {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      // Zod reports a missing field as `invalid_type` with
      // `received: "undefined"` — to a user that is "required", not
      // "expected string, received undefined".
      return issue.received === "undefined" || issue.received === "null"
        ? { key: VALIDATION_KEYS.required, values: {} }
        : { key: VALIDATION_KEYS.invalid, values: {} };

    case z.ZodIssueCode.invalid_string:
      if (issue.validation === "email") return { key: VALIDATION_KEYS.email, values: {} };
      if (issue.validation === "url") return { key: VALIDATION_KEYS.url, values: {} };
      return { key: VALIDATION_KEYS.invalid, values: {} };

    case z.ZodIssueCode.too_small:
      return issue.type === "string"
        ? { key: VALIDATION_KEYS.minLength, values: { min: Number(issue.minimum) } }
        : { key: VALIDATION_KEYS.tooSmall, values: { min: Number(issue.minimum) } };

    case z.ZodIssueCode.too_big:
      return issue.type === "string"
        ? { key: VALIDATION_KEYS.maxLength, values: { max: Number(issue.maximum) } }
        : { key: VALIDATION_KEYS.tooBig, values: { max: Number(issue.maximum) } };

    case z.ZodIssueCode.invalid_date:
      return { key: VALIDATION_KEYS.date, values: {} };

    case z.ZodIssueCode.invalid_enum_value:
    case z.ZodIssueCode.invalid_literal:
    case z.ZodIssueCode.invalid_union:
      return { key: VALIDATION_KEYS.invalid, values: {} };

    default:
      return { key: VALIDATION_KEYS.invalid, values: {} };
  }
}

/**
 * A `z.ZodErrorMap` bound to one locale's `validation` translator.
 *
 * A schema-authored message always wins (`ctx.defaultError` is only
 * consulted when the schema said nothing) — but it is itself run through
 * `translateValidationMessage`, so a schema that supplied a *key* still
 * gets translated, and a schema that supplied English prose still gets
 * that prose. Both DTO generations coexist.
 */
export function createTranslatedErrorMap(t: Translator): z.ZodErrorMap {
  return (issue, ctx) => {
    const { key, values } = mapIssue(issue);

    if (issue.message) {
      // A schema-authored *key* is rendered with the values derived from
      // the issue itself, so `minLength` still gets its `{min}` — the
      // schema said "which message", the issue says "with what numbers".
      // Schema-authored prose is returned verbatim.
      return { message: translateValidationMessage(t, issue.message, values) };
    }

    const translated = t(key, values);
    // `t()` returns the qualified key itself when a message is missing;
    // never surface that to a user — fall back to Zod's own default.
    return { message: translated === key ? ctx.defaultError : translated };
  };
}

/**
 * `schema.safeParse(input)` with localised issues.
 *
 * The error map is passed per-call rather than installed globally with
 * `z.setErrorMap()`: a global map is process-wide state, and a Node
 * server renders requests for many locales concurrently, so a global
 * would hand one user's language to another user's validation errors.
 */
export function parseWithTranslatedErrors<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  input: unknown,
  t: Translator,
): z.SafeParseReturnType<z.input<TSchema>, z.output<TSchema>> {
  return schema.safeParse(input, { errorMap: createTranslatedErrorMap(t) });
}

/**
 * Flatten a `ZodError` into the `Record<string, string[]>` shape this
 * codebase's Server Actions already return as `fieldErrors` (see
 * `ActionResult` in the `(dashboard)` actions files), with every message
 * localised. Drop-in for `error.flatten().fieldErrors`.
 */
export function toTranslatedFieldErrors(
  error: z.ZodError,
  t: Translator,
): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const path = issue.path.join(".") || "_form";
    // The ICU values are re-derived from the issue rather than taken from
    // the error map, because Zod short-circuits the error map entirely
    // when a schema supplied its own message — which is exactly the
    // pattern-1 case (`z.string().min(2, VALIDATION_KEYS.minLength)`),
    // where the key arrives here with no values attached. Deriving them
    // here means both patterns produce "at least 2 characters" and never
    // a raw "# characters".
    const message = translateValidationMessage(t, issue.message, mapIssue(issue).values);
    const existing = fieldErrors[path];
    if (existing) existing.push(message);
    else fieldErrors[path] = [message];
  }
  return fieldErrors;
}
