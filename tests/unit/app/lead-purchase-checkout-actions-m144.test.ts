import { beforeEach, describe, expect, it, vi } from "vitest";

import { LeadNotPurchasableError } from "@/domain/services/lead-purchase";
import { UnauthorizedError } from "@/domain/errors/domain-error";

/** Module 144 — the checkout Server Actions: session identity only, existing use cases only. */
const mockRequireAuth = vi.fn();
const initiateExecute = vi.fn();
const checkoutExecute = vi.fn();

vi.mock("@/infrastructure/auth/rbac", () => ({ requireAuth: () => mockRequireAuth() }));
vi.mock("@/application/use-cases/lead-checkout/compose", () => ({
  makeInitiateLeadPurchaseUseCase: () => ({ execute: initiateExecute }),
  makeGetLeadPurchaseCheckoutUseCase: () => ({ execute: checkoutExecute }),
}));

const actions = await import("../../../src/app/(dashboard)/dashboard/professional/leads/[leadId]/purchase/actions");

const LEAD = "11111111-1111-4111-8111-111111111111";
const dto = { purchaseId: "55555555-5555-4555-8555-555555555555", leadId: LEAD, status: "PENDING_PAYMENT", feeAmount: "100.00", taxAmount: "21.00", totalAmount: "121.00", currency: "EUR" };

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ id: "session-user", roles: ["PROFESSIONAL"] });
});

describe("getLeadPurchaseCheckoutAction", () => {
  it("reads with the session user id and the lead id only", async () => {
    checkoutExecute.mockResolvedValue(dto);
    expect(await actions.getLeadPurchaseCheckoutAction(LEAD)).toEqual({ success: true, purchase: dto });
    expect(checkoutExecute).toHaveBeenCalledWith("session-user", LEAD);
  });

  it("passes a null (nothing to show) through and requires a session", async () => {
    checkoutExecute.mockResolvedValue(null);
    expect(await actions.getLeadPurchaseCheckoutAction(LEAD)).toEqual({ success: true, purchase: null });
    mockRequireAuth.mockRejectedValue(new UnauthorizedError("no"));
    await expect(actions.getLeadPurchaseCheckoutAction(LEAD)).rejects.toBeInstanceOf(UnauthorizedError);
    expect(checkoutExecute).toHaveBeenCalledTimes(1);
  });

  it("turns a failure into a safe result (no raw error)", async () => {
    checkoutExecute.mockRejectedValue(new Error("PrismaClientKnownRequestError: connection refused"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await actions.getLeadPurchaseCheckoutAction(LEAD);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/Prisma|connection refused/);
  });
});

describe("startLeadPurchaseAction", () => {
  it("calls the existing initiation use case with the SESSION user and the lead id — nothing else", async () => {
    initiateExecute.mockResolvedValue({ purchaseId: dto.purchaseId });
    checkoutExecute.mockResolvedValue(dto);
    const forged = LEAD as unknown;
    const result = await actions.startLeadPurchaseAction(forged);
    expect(result).toEqual({ success: true, purchase: dto });
    expect(initiateExecute).toHaveBeenCalledTimes(1);
    expect(initiateExecute.mock.calls[0]).toEqual(["session-user", LEAD]);
    expect(actions.startLeadPurchaseAction.length).toBe(1);
  });

  it("returns the generic refusal of the use case without leaking why", async () => {
    initiateExecute.mockRejectedValue(new LeadNotPurchasableError());
    const result = await actions.startLeadPurchaseAction(LEAD);
    expect(result.success).toBe(false);
    expect(checkoutExecute).not.toHaveBeenCalled();
  });

  it("is a failure (not a fabricated purchase) when the purchase can't be read back", async () => {
    initiateExecute.mockResolvedValue({ purchaseId: dto.purchaseId });
    checkoutExecute.mockResolvedValue(null);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await actions.startLeadPurchaseAction(LEAD)).success).toBe(false);
  });

  it("requires a session before touching any use case", async () => {
    mockRequireAuth.mockRejectedValue(new UnauthorizedError("no"));
    await expect(actions.startLeadPurchaseAction(LEAD)).rejects.toBeInstanceOf(UnauthorizedError);
    expect(initiateExecute).not.toHaveBeenCalled();
  });
});
