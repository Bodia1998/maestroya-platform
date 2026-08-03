import { describe, expect, it } from "vitest";
import { z } from "zod";

import { getNamespaceMessages } from "@/infrastructure/i18n/message-loader";
import { createTranslator } from "@/shared/i18n/translator";
import {
  VALIDATION_KEYS,
  isValidationKey,
  parseWithTranslatedErrors,
  toTranslatedFieldErrors,
  translateValidationMessage,
} from "@/shared/i18n/validation-messages";

function translatorFor(locale: "es" | "en" | "pl") {
  return createTranslator({
    locale,
    namespace: "validation",
    messages: getNamespaceMessages(locale, "validation"),
  });
}

describe("translateValidationMessage", () => {
  it("translates a known key", () => {
    expect(translateValidationMessage(translatorFor("en"), VALIDATION_KEYS.required)).toBe(
      "This field is required.",
    );
    expect(translateValidationMessage(translatorFor("es"), VALIDATION_KEYS.required)).toBe(
      "Este campo es obligatorio.",
    );
  });

  it("passes an already-human message straight through", () => {
    // The pre-i18n DTOs (auth.dto.ts, profile.dto.ts, ...) still carry
    // English prose; they must keep working untouched.
    expect(translateValidationMessage(translatorFor("es"), "Enter your name.")).toBe(
      "Enter your name.",
    );
  });

  it("recognises only the documented key set", () => {
    expect(isValidationKey("required")).toBe(true);
    expect(isValidationKey("Enter your name.")).toBe(false);
  });
});

describe("parseWithTranslatedErrors", () => {
  const schema = z.object({
    email: z.string().email(),
    name: z.string().min(3),
    age: z.number().min(18),
  });

  it("localises built-in issues the schema never spelled out", () => {
    const result = parseWithTranslatedErrors(
      schema,
      { email: "nope", name: "a", age: 5 },
      translatorFor("en"),
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    const errors = toTranslatedFieldErrors(result.error, translatorFor("en"));

    expect(errors.email).toEqual(["Enter a valid email address."]);
    expect(errors.name).toEqual(["Must be at least 3 characters."]);
    expect(errors.age).toEqual(["The minimum value is 18."]);
  });

  it("maps a missing field to 'required', not to a type mismatch", () => {
    const result = parseWithTranslatedErrors(schema, {}, translatorFor("es"));
    expect(result.success).toBe(false);
    if (result.success) return;
    const errors = toTranslatedFieldErrors(result.error, translatorFor("es"));
    expect(errors.email).toEqual(["Este campo es obligatorio."]);
  });

  it("produces messages in the requested language and pluralises per language", () => {
    const result = parseWithTranslatedErrors(
      schema,
      { email: "a@b.co", name: "a", age: 20 },
      translatorFor("pl"),
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    const errors = toTranslatedFieldErrors(result.error, translatorFor("pl"));
    expect(errors.name?.[0]).toBe("Musi mieć co najmniej 3 znaki.");
  });

  it("does not install a global error map (no cross-request locale leak)", () => {
    parseWithTranslatedErrors(schema, {}, translatorFor("pl"));
    // A plain parse, with no error map, must still yield Zod's own English default.
    const plain = schema.safeParse({});
    expect(plain.success).toBe(false);
    if (plain.success) return;
    expect(plain.error.issues[0]?.message).toBe("Required");
  });

  it("keeps a schema-authored key translated and schema-authored prose intact", () => {
    const mixed = z.object({
      a: z.string().min(2, VALIDATION_KEYS.minLength),
      b: z.string().min(2, "Custom copy."),
    });
    const result = parseWithTranslatedErrors(mixed, { a: "x", b: "y" }, translatorFor("en"));
    expect(result.success).toBe(false);
    if (result.success) return;
    const errors = toTranslatedFieldErrors(result.error, translatorFor("en"));
    expect(errors.a).toEqual(["Must be at least 2 characters."]);
    expect(errors.b).toEqual(["Custom copy."]);
  });
});
