import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { VALID_BASE_ENV } from "../config/env-fixture";

async function loadModule(nodeEnv: "development" | "production") {
  const mutableEnv = process.env as Record<string, string | undefined>;
  for (const [key, value] of Object.entries(VALID_BASE_ENV)) mutableEnv[key] = value;
  mutableEnv.NODE_ENV = nodeEnv;
  if (nodeEnv === "production") {
    mutableEnv.NEXT_PUBLIC_APP_URL = "https://maestroya.example.com";
    mutableEnv.AUTH_URL = "https://maestroya.example.com";
    mutableEnv.AUTH_SECRET = "a".repeat(32);
    mutableEnv.STRIPE_SECRET_KEY = "sk_live_x";
    mutableEnv.STRIPE_PUBLISHABLE_KEY = "pk_live_x";
    // Module 39 — Sentry + CI/CD Hardening: production now requires
    // SENTRY_DSN (see env.ts's superRefine) — set to a syntactically
    // valid but fake DSN. Left unresolvable (no real Sentry project) is
    // fine here: createErrorReporter()'s SentryErrorReporter falls back
    // to the logger if the SDK fails to load, so this test's existing
    // assertions on logged/returned content are unaffected either way.
    mutableEnv.SENTRY_DSN = "https://examplePublicKey@o0.ingest.sentry.io/0";
  }
  vi.resetModules();
  const [errorModule, domainErrorModule] = await Promise.all([
    import("@/infrastructure/observability/http-error-response"),
    import("@/domain/errors/domain-error"),
  ]);
  return { ...errorModule, ...domainErrorModule };
}

describe("infrastructure/observability/http-error-response", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, "error").mockImplementation(() => undefined); // logger routes warn through console.error too
  });

  afterEach(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("maps a known DomainError to its safe status/code/message", async () => {
    const { toHttpErrorResponse, NotFoundError } = await loadModule("development");
    const response = toHttpErrorResponse(new NotFoundError("Job", "job_1"), {
      requestId: "req-1",
      route: "/api/test",
    });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("NOT_FOUND");
    expect(body.requestId).toBe("req-1");
    expect(body.error).toMatch(/Job/);
  });

  it("hides unexpected error details behind a generic message in production", async () => {
    const { toHttpErrorResponse } = await loadModule("production");
    const response = toHttpErrorResponse(new Error("column \"secret_column\" does not exist"), {
      requestId: "req-2",
      route: "/api/test",
    });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe("INTERNAL_ERROR");
    expect(body.error).not.toMatch(/secret_column/);
    expect(body.requestId).toBe("req-2");
  });

  it("surfaces the real error message outside production for local debugging", async () => {
    const { toHttpErrorResponse } = await loadModule("development");
    const response = toHttpErrorResponse(new Error("helpful local detail"), {
      requestId: "req-3",
      route: "/api/test",
    });

    const body = await response.json();
    expect(body.error).toMatch(/helpful local detail/);
  });

  it("maps RateLimitedError to 429", async () => {
    const { toHttpErrorResponse, RateLimitedError } = await loadModule("development");
    const response = toHttpErrorResponse(new RateLimitedError("Too many requests.", 5000), {
      requestId: null,
      route: "/api/test",
    });
    expect(response.status).toBe(429);
  });

  describe("error reporting (Module 39 — Sentry + CI/CD Hardening)", () => {
    it("reports an unexpected error to the ErrorReporter", async () => {
      vi.resetModules();
      const mutableEnv = process.env as Record<string, string | undefined>;
      for (const [key, value] of Object.entries(VALID_BASE_ENV)) mutableEnv[key] = value;
      mutableEnv.NODE_ENV = "development";

      const factory = await import("@/infrastructure/observability/error-reporter-factory");
      const reportSpy = vi.spyOn(factory.createErrorReporter(), "reportException");

      const { toHttpErrorResponse } = await import("@/infrastructure/observability/http-error-response");
      toHttpErrorResponse(new Error("unexpected"), { requestId: "req-4", route: "/api/test" });

      expect(reportSpy).toHaveBeenCalledTimes(1);
      const [reportedError] = reportSpy.mock.calls[0]!;
      expect((reportedError as Error).message).toBe("unexpected");
      reportSpy.mockRestore();
    });

    it("does not report an expected DomainError to the ErrorReporter", async () => {
      vi.resetModules();
      const mutableEnv = process.env as Record<string, string | undefined>;
      for (const [key, value] of Object.entries(VALID_BASE_ENV)) mutableEnv[key] = value;
      mutableEnv.NODE_ENV = "development";

      const factory = await import("@/infrastructure/observability/error-reporter-factory");
      const reportSpy = vi.spyOn(factory.createErrorReporter(), "reportException");

      const { toHttpErrorResponse } = await import("@/infrastructure/observability/http-error-response");
      const { NotFoundError } = await import("@/domain/errors/domain-error");
      toHttpErrorResponse(new NotFoundError("Job", "job_1"), { requestId: "req-5", route: "/api/test" });

      expect(reportSpy).not.toHaveBeenCalled();
      reportSpy.mockRestore();
    });
  });
});
