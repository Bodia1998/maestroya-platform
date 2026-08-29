import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Module 81 — Reconciliation Admin Dashboard & Operations: Server Action
 * tests for `src/app/(dashboard)/admin/reconciliation/actions.ts` — same
 * mock-`requireRole`-and-the-use-case pattern as
 * `admin-disputes-actions.test.ts`. Covers every action this module added
 * (`listReconciliationRunsAction`, `listDiscrepanciesAction`,
 * `getReconciliationOverviewAction`, `getReconciliationProviderBindingAction`,
 * `getReconciliationDiscrepancyAction`, `getReconciliationRunSeverityBreakdownAction`)
 * plus the authorization/duplicate-submission/not-found behavior of the
 * two pre-existing mutating actions this module's UI drives
 * (`startReconciliationRunAction`, `resolveDiscrepancyAction`). This file
 * verifies only the Server Action boundary — every use case's own
 * orchestration is covered by its own unit tests under
 * `tests/unit/core/application/use-cases/reconciliation/`.
 */
const mockRequireRole = vi.fn();
const mockGetCurrentUser = vi.fn();
const mockRevalidatePath = vi.fn();

const mockListRuns = vi.fn();
const mockListDiscrepancies = vi.fn();
const mockGetOverview = vi.fn();
const mockGetRunSeverityBreakdown = vi.fn();
const mockGetDiscrepancyById = vi.fn();
const mockStartRun = vi.fn();
const mockResolveDiscrepancy = vi.fn();

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

vi.mock("@/infrastructure/auth/rbac", () => ({
  ROLES: { ADMIN: "ADMIN", SUPER_ADMIN: "SUPER_ADMIN", SUPPORT: "SUPPORT" },
  requireRole: (...allowed: string[]) => mockRequireRole(...allowed),
  getCurrentUser: () => mockGetCurrentUser(),
}));

vi.mock("@/application/use-cases/reconciliation/compose", () => ({
  makeStartReconciliationRunUseCase: () => ({ execute: mockStartRun }),
  makeGetReconciliationRunUseCase: () => ({ execute: vi.fn() }),
  makeListDiscrepanciesForRunUseCase: () => ({ execute: vi.fn() }),
  makeListUnresolvedHighSeverityDiscrepanciesUseCase: () => ({ execute: vi.fn() }),
  makeResolveDiscrepancyUseCase: () => ({ execute: mockResolveDiscrepancy }),
  makeGetFinancialEntitySnapshotUseCase: () => ({ execute: vi.fn() }),
  makeListReconciliationRunsUseCase: () => ({ execute: mockListRuns }),
  makeListDiscrepanciesUseCase: () => ({ execute: mockListDiscrepancies }),
  makeGetReconciliationOverviewUseCase: () => ({ execute: mockGetOverview }),
  makeGetReconciliationRunSeverityBreakdownUseCase: () => ({ execute: mockGetRunSeverityBreakdown }),
  makeGetDiscrepancyByIdUseCase: () => ({ execute: mockGetDiscrepancyById }),
  RECONCILIATION_PROVIDER_BINDING_LABEL: "Null adapter (not connected to a live provider)",
}));

const {
  listReconciliationRunsAction,
  listDiscrepanciesAction,
  getReconciliationOverviewAction,
  getReconciliationProviderBindingAction,
  getReconciliationDiscrepancyAction,
  getReconciliationRunSeverityBreakdownAction,
  startReconciliationRunAction,
  resolveDiscrepancyAction,
} = await import("../../../src/app/(dashboard)/admin/reconciliation/actions");
const { UnauthorizedError, NotFoundError, ConflictError } = await import("../../../src/core/domain/errors/domain-error");

const VALID_UUID = "11111111-1111-1111-1111-111111111111";

describe("admin/reconciliation/actions — authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["listReconciliationRunsAction", () => listReconciliationRunsAction()],
    ["listDiscrepanciesAction", () => listDiscrepanciesAction()],
    ["getReconciliationOverviewAction", () => getReconciliationOverviewAction()],
    ["getReconciliationProviderBindingAction", () => getReconciliationProviderBindingAction()],
    ["getReconciliationDiscrepancyAction", () => getReconciliationDiscrepancyAction(VALID_UUID)],
    ["getReconciliationRunSeverityBreakdownAction", () => getReconciliationRunSeverityBreakdownAction(VALID_UUID)],
    ["startReconciliationRunAction", () => startReconciliationRunAction()],
    [
      "resolveDiscrepancyAction",
      () => resolveDiscrepancyAction({ discrepancyId: VALID_UUID, reason: "Investigated and verified." }),
    ],
  ])("%s requires ADMIN/SUPER_ADMIN and never reaches the use case when denied", async (_name, call) => {
    mockRequireRole.mockRejectedValue(new UnauthorizedError("You do not have permission to do that."));

    await expect(call()).rejects.toBeInstanceOf(UnauthorizedError);

    expect(mockListRuns).not.toHaveBeenCalled();
    expect(mockListDiscrepancies).not.toHaveBeenCalled();
    expect(mockGetOverview).not.toHaveBeenCalled();
    expect(mockGetDiscrepancyById).not.toHaveBeenCalled();
    expect(mockGetRunSeverityBreakdown).not.toHaveBeenCalled();
    expect(mockStartRun).not.toHaveBeenCalled();
    expect(mockResolveDiscrepancy).not.toHaveBeenCalled();
  });
});

describe("listReconciliationRunsAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the runs the use case produces, passing filters through", async () => {
    mockRequireRole.mockResolvedValue({ id: "admin-1" });
    mockListRuns.mockResolvedValue([{ id: "run-1" }]);

    const result = await listReconciliationRunsAction({ status: "FAILED", limit: 20, offset: 0 });

    expect(result).toEqual({ success: true, data: [{ id: "run-1" }] });
    expect(mockListRuns).toHaveBeenCalledWith(expect.objectContaining({ status: "FAILED", limit: 20, offset: 0 }));
  });

  it("rejects an invalid filter value before reaching the use case", async () => {
    mockRequireRole.mockResolvedValue({ id: "admin-1" });

    const result = await listReconciliationRunsAction({ status: "NOT_A_STATUS" });

    expect(result.success).toBe(false);
    expect(mockListRuns).not.toHaveBeenCalled();
  });
});

describe("listDiscrepanciesAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes every supported filter through to the use case", async () => {
    mockRequireRole.mockResolvedValue({ id: "admin-1" });
    mockListDiscrepancies.mockResolvedValue([]);

    await listDiscrepanciesAction({
      resolutionStatus: "OPEN",
      severity: "CRITICAL",
      entityType: "PAYMENT",
      category: "PAYMENT_AMOUNT_MISMATCH",
      detectedFrom: "2026-08-01",
      detectedTo: "2026-08-31",
    });

    expect(mockListDiscrepancies).toHaveBeenCalledWith(
      expect.objectContaining({
        resolutionStatus: "OPEN",
        severity: "CRITICAL",
        entityType: "PAYMENT",
        category: "PAYMENT_AMOUNT_MISMATCH",
      }),
    );
  });
});

describe("getReconciliationDiscrepancyAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns success:false (not a thrown error) when the discrepancy doesn't exist", async () => {
    mockRequireRole.mockResolvedValue({ id: "admin-1" });
    mockGetDiscrepancyById.mockRejectedValue(new NotFoundError("ReconciliationDiscrepancy", VALID_UUID));

    const result = await getReconciliationDiscrepancyAction(VALID_UUID);

    expect(result.success).toBe(false);
  });

  it("rejects a malformed id before reaching the use case", async () => {
    mockRequireRole.mockResolvedValue({ id: "admin-1" });

    const result = await getReconciliationDiscrepancyAction("not-a-uuid");

    expect(result.success).toBe(false);
    expect(mockGetDiscrepancyById).not.toHaveBeenCalled();
  });
});

describe("startReconciliationRunAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("starts a run and revalidates the reconciliation pages on success", async () => {
    mockRequireRole.mockResolvedValue({ id: "admin-1" });
    mockGetCurrentUser.mockResolvedValue({ id: "admin-1" });
    mockStartRun.mockResolvedValue({ run: { id: "run-1" }, discrepanciesCreated: 0, discrepanciesReconfirmed: 0 });

    const result = await startReconciliationRunAction({ scope: "FULL", limit: 500 });

    expect(result.success).toBe(true);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/reconciliation");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/reconciliation/runs");
  });
});

describe("resolveDiscrepancyAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolves successfully and revalidates the discrepancy pages", async () => {
    mockRequireRole.mockResolvedValue({ id: "admin-1" });
    mockResolveDiscrepancy.mockResolvedValue({ id: VALID_UUID, resolutionStatus: "RESOLVED" });

    const result = await resolveDiscrepancyAction({ discrepancyId: VALID_UUID, reason: "Verified — timing difference only." });

    expect(result).toEqual({ success: true, data: { id: VALID_UUID, resolutionStatus: "RESOLVED" } });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/reconciliation");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/reconciliation/discrepancies");
    expect(mockRevalidatePath).toHaveBeenCalledWith(`/admin/reconciliation/discrepancies/${VALID_UUID}`);
  });

  it("surfaces a duplicate-resolution attempt as a normal error, not a thrown exception", async () => {
    mockRequireRole.mockResolvedValue({ id: "admin-1" });
    mockResolveDiscrepancy.mockRejectedValue(new ConflictError(`Discrepancy ${VALID_UUID} is already resolved.`));

    const result = await resolveDiscrepancyAction({ discrepancyId: VALID_UUID, reason: "Trying again." });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("already resolved");
    }
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("rejects a reason shorter than 3 characters before reaching the use case", async () => {
    mockRequireRole.mockResolvedValue({ id: "admin-1" });

    const result = await resolveDiscrepancyAction({ discrepancyId: VALID_UUID, reason: "ok" });

    expect(result.success).toBe(false);
    expect(mockResolveDiscrepancy).not.toHaveBeenCalled();
  });
});

describe("getReconciliationProviderBindingAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the composition root's provider binding label", async () => {
    mockRequireRole.mockResolvedValue({ id: "admin-1" });

    const result = await getReconciliationProviderBindingAction();

    expect(result).toEqual({ success: true, data: { label: "Null adapter (not connected to a live provider)" } });
  });
});
