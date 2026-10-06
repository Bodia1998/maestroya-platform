import { beforeEach, describe, expect, it, vi } from "vitest";

import { UnauthorizedError, ValidationError } from "@/domain/errors/domain-error";

/** Module 134 — the feed Server Action takes identity from the session only and delegates to exactly one use case. */
const mockRequireAuth = vi.fn();
const feedExecute = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/infrastructure/auth/rbac", () => ({ requireAuth: () => mockRequireAuth() }));
vi.mock("@/application/use-cases/lead/compose", () => ({
  makeGetLeadFeedForProfessionalUseCase: () => ({ execute: feedExecute }),
  makeGetPublishedLeadPreviewsForProfessionalUseCase: () => ({ execute: vi.fn() }),
  makeGetPublishedLeadPreviewUseCase: () => ({ execute: vi.fn() }),
}));

const actions = await import("../../../src/app/(dashboard)/dashboard/professional/leads/actions");

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ id: "session-user", roles: ["PROFESSIONAL"] });
});

describe("getLeadFeedAction", () => {
  it("uses the session user id and ignores any client-supplied identity", async () => {
    feedExecute.mockResolvedValue({ items: [], nextCursor: null });
    const forged = { limit: 5, cursor: "c", categoryId: "cat", userId: "victim", professionalId: "victim-pro" } as never;
    const result = await actions.getLeadFeedAction(forged);
    expect(result).toEqual({ success: true, items: [], nextCursor: null });
    const [userId, input] = feedExecute.mock.calls[0]!;
    expect(userId).toBe("session-user");
    expect(input).toEqual({ limit: 5, cursor: "c", categoryId: "cat" });
    expect(input).not.toHaveProperty("userId");
    expect(input).not.toHaveProperty("professionalId");
  });

  it("requires a session (unauthenticated callers never reach the use case)", async () => {
    mockRequireAuth.mockRejectedValue(new UnauthorizedError("no"));
    await expect(actions.getLeadFeedAction()).rejects.toBeInstanceOf(UnauthorizedError);
    expect(feedExecute).not.toHaveBeenCalled();
  });

  it("returns a failure result for invalid input instead of throwing", async () => {
    feedExecute.mockRejectedValue(new ValidationError("Invalid feed cursor."));
    const result = await actions.getLeadFeedAction({ cursor: "bad" });
    expect(result.success).toBe(false);
  });
});
