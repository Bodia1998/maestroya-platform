import { beforeEach, describe, expect, it, vi } from "vitest";

import { RateLimitedError, UnauthorizedError, ValidationError } from "@/domain/errors/domain-error";
import { LeadRequestCategoryUnsupportedError } from "@/application/use-cases/lead-request/submit-lead-request.use-case";

/**
 * Module 142 — the customer LEAD_V1 submission Server Action: identity from
 * the session only, thin delegation to ONE use case, and an explicit
 * customer-safe result.
 */
const mockRequireAuth = vi.fn();
const execute = vi.fn();
const enforceRateLimit = vi.fn();
const assertNotBlocked = vi.fn();
const warn = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/infrastructure/auth/rbac", () => ({ requireAuth: () => mockRequireAuth() }));
vi.mock("@/infrastructure/observability/logger", () => ({ logger: { warn: (...a: unknown[]) => warn(...a), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("@/application/use-cases/security/compose", () => ({ makeAntiAbuseService: () => ({ assertNotBlocked, enforceRateLimit }) }));
vi.mock("@/application/use-cases/lead-request/compose", () => ({ makeSubmitLeadRequestUseCase: () => ({ execute }) }));

const { submitLeadRequestAction } = await import("../../../src/app/(dashboard)/requests/new/lead/actions");

const input = {
  categoryId: "123e4567-e89b-42d3-a456-426614174000",
  title: "Fuga en el baño",
  description: "El grifo del lavabo gotea desde hace dos días.",
  location: { line1: "Calle Mayor 1", city: "Madrid", postalCode: "28001", country: "ES" },
};
const receipt = { requestId: "sr-1", status: "RECEIVED" as const };

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ id: "session-user", roles: ["CUSTOMER"] });
  enforceRateLimit.mockResolvedValue(undefined);
  assertNotBlocked.mockResolvedValue(undefined);
  execute.mockResolvedValue({ receipt, publication: "PUBLISHED" });
});

describe("authentication", () => {
  it("rejects an unauthenticated submission without touching the use case", async () => {
    mockRequireAuth.mockRejectedValue(new UnauthorizedError("no"));
    const result = await submitLeadRequestAction(input);
    expect(result).toMatchObject({ success: false, code: "UNAUTHENTICATED" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("does not swallow unexpected authentication infrastructure errors", async () => {
    mockRequireAuth.mockRejectedValue(new Error("session store down"));
    await expect(submitLeadRequestAction(input)).rejects.toThrow("session store down");
  });
});

describe("identity and authorization", () => {
  it("uses the session user and ignores browser-supplied identity, flow, status and ids", async () => {
    const result = await submitLeadRequestAction({
      ...input,
      userId: "victim",
      customerId: "victim-customer",
      professionalId: "pro-1",
      flowVersion: "LEGACY_QUOTE_PAYMENT",
      status: "PUBLISHED",
      leadId: "lead-x",
      requestId: "someone-elses-request",
    });
    expect(result).toEqual({ success: true, receipt });
    const [userId, parsed] = execute.mock.calls[0]!;
    expect(userId).toBe("session-user");
    for (const key of ["userId", "customerId", "professionalId", "flowVersion", "status", "leadId", "requestId"]) {
      expect(parsed, key).not.toHaveProperty(key);
    }
  });

  it("applies the same abuse protection as the legacy creation action, keyed on the session user", async () => {
    await submitLeadRequestAction(input);
    expect(assertNotBlocked).toHaveBeenCalledWith("session-user");
    expect(enforceRateLimit).toHaveBeenCalledWith("SERVICE_REQUEST_CREATE_BY_USER", { userId: "session-user" }, "SERVICE_REQUEST_RATE_LIMITED");
  });

  it("returns a localized failure when rate limited, without creating anything", async () => {
    enforceRateLimit.mockRejectedValue(new RateLimitedError("slow down", 30));
    const result = await submitLeadRequestAction(input);
    expect(result).toMatchObject({ success: false, code: "FAILED" });
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("validation", () => {
  it.each([
    ["missing category", { ...input, categoryId: "" }, "categoryId"],
    ["missing description", { ...input, description: "" }, "description"],
    ["short description", { ...input, description: "corta" }, "description"],
    ["empty address", { ...input, location: { line1: "", city: "", postalCode: "", country: "ES" } }, "location.line1"],
  ])("rejects %s with field errors and no side effects", async (_label, body, field) => {
    const result = await submitLeadRequestAction(body);
    expect(result).toMatchObject({ success: false, code: "INVALID" });
    expect((result as { fieldErrors?: Record<string, string[]> }).fieldErrors).toHaveProperty([field]);
    expect(execute).not.toHaveBeenCalled();
    expect(assertNotBlocked).not.toHaveBeenCalled();
  });

  it("never echoes raw schema keys or internals in validation messages", async () => {
    const result = await submitLeadRequestAction({ ...input, description: "" });
    expect(JSON.stringify(result)).not.toMatch(/dto\.|ZodError|Prisma|stack/);
  });
});

describe("submission outcome", () => {
  it("returns exactly the safe receipt on success", async () => {
    const result = await submitLeadRequestAction(input);
    expect(result).toEqual({ success: true, receipt: { requestId: "sr-1", status: "RECEIVED" } });
  });

  it("does not leak the internal publication outcome, and logs a deferred publication server-side", async () => {
    execute.mockResolvedValue({ receipt, publication: "DEFERRED" });
    const result = await submitLeadRequestAction(input);
    expect(result).toEqual({ success: true, receipt });
    expect(warn).toHaveBeenCalledWith("lead_request.publication_deferred", { requestId: "sr-1" });
  });

  it("maps an unsupported category to a field error", async () => {
    execute.mockRejectedValue(new LeadRequestCategoryUnsupportedError());
    const result = await submitLeadRequestAction(input);
    expect(result).toMatchObject({ success: false, code: "CATEGORY_UNSUPPORTED" });
    expect((result as { fieldErrors?: Record<string, string[]> }).fieldErrors?.categoryId?.[0]).toBeTruthy();
  });

  it("surfaces a domain validation failure as a safe failure result", async () => {
    execute.mockRejectedValue(new ValidationError("Selected service category is invalid or inactive."));
    expect(await submitLeadRequestAction(input)).toMatchObject({ success: false, code: "FAILED" });
  });

  it("hides infrastructure errors behind a generic message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    execute.mockRejectedValue(new Error('PrismaClientKnownRequestError: P2002 at /srv/app/stack.ts sk_live_secret'));
    const result = await submitLeadRequestAction(input);
    expect(result).toMatchObject({ success: false, code: "FAILED" });
    expect(JSON.stringify(result)).not.toMatch(/Prisma|P2002|stack|sk_live|\/srv/);
  });
});

describe("response safety", () => {
  it("never carries contact, payment, pricing or internal-state data", async () => {
    execute.mockResolvedValue({
      receipt,
      publication: "PUBLISHED",
      // a hostile/careless use case result must not be forwarded wholesale
      lead: { id: "lead-1", paymentReference: "pi_x", clientSecret: "pi_x_secret_y", professionalPhone: "+34600000000", pricingSnapshot: { amount: "10.00" } },
    });
    const json = JSON.stringify(await submitLeadRequestAction(input));
    expect(json).not.toMatch(/phone|email|clientSecret|client_secret|paymentReference|pi_x|LeadPurchase|snapshot|buyerPolicy|LEAD_V1|PENDING_PAYMENT|lead-1/i);
  });
});
