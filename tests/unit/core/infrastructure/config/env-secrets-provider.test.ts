import { describe, expect, it } from "vitest";

import { EnvSecretsProvider } from "@/infrastructure/config/env-secrets-provider";
import { SECRET_ENV_KEYS } from "@/infrastructure/config/config-resolver";
import { buildTestEnv } from "./platform-config-env-fixture";

describe("infrastructure/config/env-secrets-provider", () => {
  it("hasSecret is true for a secret set on the env fixture and false for one that is unset", () => {
    const provider = new EnvSecretsProvider(buildTestEnv({ REDIS_URL: "redis://localhost:6379" }));

    expect(provider.hasSecret("REDIS_URL")).toBe(true);
    expect(provider.hasSecret("MAPBOX_API_KEY")).toBe(false);
  });

  it("getSecret returns the configured value for a set secret", () => {
    const provider = new EnvSecretsProvider(buildTestEnv({ DATABASE_URL: "postgresql://u:p@host/db" }));
    expect(provider.getSecret("DATABASE_URL")).toBe("postgresql://u:p@host/db");
  });

  it("getSecret returns null for an unset secret, never undefined or an empty string", () => {
    const provider = new EnvSecretsProvider(buildTestEnv());
    expect(provider.getSecret("HERE_API_KEY")).toBeNull();
  });

  it("getSecret/hasSecret return null/false for a key this provider does not know about at all", () => {
    const provider = new EnvSecretsProvider(buildTestEnv());
    expect(provider.getSecret("NOT_A_REAL_KEY")).toBeNull();
    expect(provider.hasSecret("NOT_A_REAL_KEY")).toBe(false);
  });

  it("listKnownKeys returns exactly SECRET_ENV_KEYS, regardless of which are actually set", () => {
    const provider = new EnvSecretsProvider(buildTestEnv());
    expect(provider.listKnownKeys()).toEqual(SECRET_ENV_KEYS);
  });

  it("required secrets from the base fixture (always non-empty strings) are always reported as set", () => {
    const provider = new EnvSecretsProvider(buildTestEnv());
    expect(provider.hasSecret("AUTH_SECRET")).toBe(true);
    expect(provider.hasSecret("DATABASE_URL")).toBe(true);
    expect(provider.hasSecret("RESEND_API_KEY")).toBe(true);
    expect(provider.hasSecret("STRIPE_SECRET_KEY")).toBe(true);
    expect(provider.hasSecret("STRIPE_WEBHOOK_SECRET")).toBe(true);
    expect(provider.hasSecret("CLOUDINARY_API_KEY")).toBe(true);
    expect(provider.hasSecret("CLOUDINARY_API_SECRET")).toBe(true);
  });

  it("never exposes a non-secret field (e.g. AUTH_GOOGLE_ID, a public client id) through getSecret/hasSecret", () => {
    const provider = new EnvSecretsProvider(buildTestEnv({ AUTH_GOOGLE_ID: "public-client-id" }));
    expect(provider.hasSecret("AUTH_GOOGLE_ID")).toBe(false);
    expect(provider.getSecret("AUTH_GOOGLE_ID")).toBeNull();
  });
});
