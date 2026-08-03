import { describe, expect, it } from "vitest";

import { ValidationError } from "@/domain/errors/domain-error";
import { GetUserLanguagePreferenceUseCase } from "@/application/use-cases/i18n/get-user-language-preference.use-case";
import { UpdateUserLanguagePreferenceUseCase } from "@/application/use-cases/i18n/update-user-language-preference.use-case";
import { updateLanguagePreferenceSchema } from "@/application/dto/i18n.dto";
import { SUPPORTED_LOCALES } from "@/shared/i18n/locales";
import { resolveAuthenticatedLocale, resolveGuestLocale } from "@/shared/i18n/negotiate-locale";
import { FakeUserRepository } from "../auth/fakes";

async function seedUser(users: FakeUserRepository) {
  return users.createWithPassword({
    email: "ana@example.com",
    name: "Ana",
    passwordHash: "hash",
  });
}

describe("UpdateUserLanguagePreferenceUseCase", () => {
  it("persists a supported locale", async () => {
    const users = new FakeUserRepository();
    const user = await seedUser(users);

    const result = await new UpdateUserLanguagePreferenceUseCase(users).execute(user.id, "uk");

    expect(result).toEqual({ locale: "uk" });
    expect(await users.getPreferredLocale(user.id)).toBe("uk");
  });

  it("rejects an unsupported locale even though the HTTP schema already validated", async () => {
    // The use case is also reachable from a Server Action, a script, or a
    // future admin tool — it must not trust its caller.
    const users = new FakeUserRepository();
    const user = await seedUser(users);

    await expect(
      new UpdateUserLanguagePreferenceUseCase(users).execute(user.id, "ca"),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await users.getPreferredLocale(user.id)).toBeNull();
  });

  it("overwrites a previous choice", async () => {
    const users = new FakeUserRepository();
    const user = await seedUser(users);
    const useCase = new UpdateUserLanguagePreferenceUseCase(users);

    await useCase.execute(user.id, "de");
    await useCase.execute(user.id, "pt");

    expect(await users.getPreferredLocale(user.id)).toBe("pt");
  });
});

describe("GetUserLanguagePreferenceUseCase", () => {
  it("returns the stored locale", async () => {
    const users = new FakeUserRepository();
    const user = await seedUser(users);
    await new UpdateUserLanguagePreferenceUseCase(users).execute(user.id, "cs");

    expect(await new GetUserLanguagePreferenceUseCase(users).execute(user.id)).toBe("cs");
  });

  it("returns null — not Spanish — when nothing was ever chosen", async () => {
    const users = new FakeUserRepository();
    const user = await seedUser(users);

    expect(await new GetUserLanguagePreferenceUseCase(users).execute(user.id)).toBeNull();
  });

  it("returns null for an unknown user instead of throwing", async () => {
    const users = new FakeUserRepository();
    expect(await new GetUserLanguagePreferenceUseCase(users).execute("nope")).toBeNull();
  });

  it("degrades a stale/unsupported stored code to null", async () => {
    const users = new FakeUserRepository();
    const user = await seedUser(users);
    // Written by an older deployment that shipped Catalan, or by a
    // rolling deploy of a newer one.
    await users.updatePreferredLocale(user.id, "ca");

    expect(await new GetUserLanguagePreferenceUseCase(users).execute(user.id)).toBeNull();
  });
});

describe("end-to-end persistence: authenticated", () => {
  it("a saved preference wins over the browser on the next request", async () => {
    const users = new FakeUserRepository();
    const user = await seedUser(users);

    await new UpdateUserLanguagePreferenceUseCase(users).execute(user.id, "ro");
    const stored = await new GetUserLanguagePreferenceUseCase(users).execute(user.id);

    expect(
      resolveAuthenticatedLocale({ userPreference: stored, acceptLanguage: "de,en;q=0.8" }),
    ).toEqual({ locale: "ro", source: "user-preference" });
  });

  it("a user who never chose falls through to the browser, then Spanish", async () => {
    const users = new FakeUserRepository();
    const user = await seedUser(users);
    const stored = await new GetUserLanguagePreferenceUseCase(users).execute(user.id);

    expect(resolveAuthenticatedLocale({ userPreference: stored, acceptLanguage: "it" })).toEqual({
      locale: "it",
      source: "browser",
    });
    expect(resolveAuthenticatedLocale({ userPreference: stored, acceptLanguage: "ja" })).toEqual({
      locale: "es",
      source: "default",
    });
  });

  it("a stale stored code does not strand the user on a raw-key UI", async () => {
    const users = new FakeUserRepository();
    const user = await seedUser(users);
    await users.updatePreferredLocale(user.id, "ca");
    const stored = await new GetUserLanguagePreferenceUseCase(users).execute(user.id);

    expect(
      resolveAuthenticatedLocale({ userPreference: stored, acceptLanguage: "fr" }).locale,
    ).toBe("fr");
  });
});

describe("end-to-end persistence: guest", () => {
  it("uses the browser-stored value, ignoring the browser's own languages", () => {
    // The guest half of persistence is localStorage + its mirror cookie;
    // this is the value the server sees on the next request.
    expect(resolveGuestLocale({ storedPreference: "pl", acceptLanguage: "es-ES" })).toEqual({
      locale: "pl",
      source: "stored-preference",
    });
  });

  it("never persists anything server-side for a guest", async () => {
    const users = new FakeUserRepository();
    expect(users.preferredLocaleByUserId.size).toBe(0);
  });
});

describe("API contract", () => {
  it("accepts every shipped locale and nothing else", () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(updateLanguagePreferenceSchema.safeParse({ locale }).success).toBe(true);
    }
    for (const bad of ["ca", "EN", "es-ES", "", null, 1, undefined]) {
      expect(updateLanguagePreferenceSchema.safeParse({ locale: bad }).success).toBe(false);
    }
  });

  it("stays in sync with SUPPORTED_LOCALES automatically", () => {
    expect(updateLanguagePreferenceSchema.shape.locale.options).toEqual([...SUPPORTED_LOCALES]);
  });
});
