import { beforeEach, describe, expect, it, vi } from "vitest";

import { UnauthorizedError } from "@/domain/errors/domain-error";
import { LeadNotPublishableError } from "@/domain/services/lead";

/**
 * Module 125 — the Lead Marketplace Server Actions are thin: they must take
 * identity from the session, never from input, and delegate to exactly one
 * use case. The use cases themselves are covered in
 * tests/unit/core/application/use-cases/lead/.
 */
const mockRequireAuth = vi.fn();
const createExecute = vi.fn();
const publishExecute = vi.fn();
const listExecute = vi.fn();
const oneExecute = vi.fn();
const enforceRateLimit = vi.fn();
const assertNotBlocked = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/infrastructure/auth/rbac", () => ({ requireAuth: () => mockRequireAuth() }));
vi.mock("@/application/use-cases/security/compose", () => ({ makeAntiAbuseService: () => ({ assertNotBlocked, enforceRateLimit }) }));
vi.mock("@/application/use-cases/lead/compose", () => ({
  makeCreateLeadV1ServiceRequestUseCase: () => ({ execute: createExecute }),
  makePublishLeadUseCase: () => ({ execute: publishExecute }),
  makeGetPublishedLeadPreviewsForProfessionalUseCase: () => ({ execute: listExecute }),
  makeGetPublishedLeadPreviewUseCase: () => ({ execute: oneExecute }),
}));

const customerActions = await import("../../../src/app/(dashboard)/requests/lead-actions");
const proActions = await import("../../../src/app/(dashboard)/dashboard/professional/leads/actions");

const LEAD = "11111111-1111-4111-8111-111111111111";
const input = {
  categoryId: "123e4567-e89b-12d3-a456-426614174000",
  title: "Fuga",
  description: "Fuga en el baño",
  location: { line1: "Calle 1", city: "Madrid", postalCode: "28001", country: "ES" },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ id: "session-user", roles: ["CUSTOMER"] });
  enforceRateLimit.mockResolvedValue(undefined);
  assertNotBlocked.mockResolvedValue(undefined);
});

describe("createLeadServiceRequestAction", () => {
  it("uses the session user as owner and strips client-supplied owner/flow fields", async () => {
    createExecute.mockResolvedValue({ serviceRequest: { id: "sr-1" }, lead: { id: "lead-1" } });
    const result = await customerActions.createLeadServiceRequestAction({
      ...input, userId: "victim", customerId: "victim-cust", flowVersion: "LEGACY_QUOTE_PAYMENT",
    });
    expect(result).toEqual({ success: true, serviceRequestId: "sr-1", leadId: "lead-1" });
    const [userId, parsed] = createExecute.mock.calls[0]!;
    expect(userId).toBe("session-user");
    expect(parsed).not.toHaveProperty("userId");
    expect(parsed).not.toHaveProperty("customerId");
    expect(parsed).not.toHaveProperty("flowVersion");
  });

  it("rejects invalid input before any use case runs", async () => {
    const result = await customerActions.createLeadServiceRequestAction({ ...input, title: "" });
    expect(result.success).toBe(false);
    expect(createExecute).not.toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    mockRequireAuth.mockRejectedValue(new UnauthorizedError("no"));
    await expect(customerActions.createLeadServiceRequestAction(input)).rejects.toBeInstanceOf(UnauthorizedError);
    expect(createExecute).not.toHaveBeenCalled();
  });

  it("applies the same abuse protection as the legacy creation action", async () => {
    await customerActions.createLeadServiceRequestAction(input).catch(() => undefined);
    expect(assertNotBlocked).toHaveBeenCalledWith("session-user");
    expect(enforceRateLimit).toHaveBeenCalledWith("SERVICE_REQUEST_CREATE_BY_USER", { userId: "session-user" }, "SERVICE_REQUEST_RATE_LIMITED");
  });
});

describe("publishLeadAction", () => {
  it("publishes with the session user and never a client-supplied owner", async () => {
    publishExecute.mockResolvedValue({ id: LEAD });
    expect(await customerActions.publishLeadAction(LEAD)).toEqual({ success: true, leadId: LEAD });
    expect(publishExecute).toHaveBeenCalledWith("session-user", LEAD);
  });

  it("rejects a malformed lead id without calling the use case", async () => {
    expect((await customerActions.publishLeadAction("x")).success).toBe(false);
    expect(publishExecute).not.toHaveBeenCalled();
  });

  it("surfaces domain errors as a failure result", async () => {
    publishExecute.mockRejectedValue(new LeadNotPublishableError("CLOSED"));
    expect((await customerActions.publishLeadAction(LEAD)).success).toBe(false);
  });
});

describe("professional preview actions", () => {
  it("delegate to the Module 124 use cases with the session user", async () => {
    listExecute.mockResolvedValue([]);
    oneExecute.mockResolvedValue({ leadId: LEAD });
    expect(await proActions.getLeadPreviewsAction()).toEqual({ success: true, leads: [] });
    expect(listExecute).toHaveBeenCalledWith("session-user");
    expect(await proActions.getLeadPreviewAction(LEAD)).toEqual({ success: true, lead: { leadId: LEAD } });
    expect(oneExecute).toHaveBeenCalledWith("session-user", LEAD);
  });

  it("returns a failure (not a throw) when the use case denies access", async () => {
    oneExecute.mockRejectedValue(new LeadNotPublishableError("DRAFT"));
    expect((await proActions.getLeadPreviewAction(LEAD)).success).toBe(false);
  });
});
