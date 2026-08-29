"use server";

import { revalidatePath } from "next/cache";

import {
  getDiscrepancySchema,
  getFinancialEntitySnapshotSchema,
  getReconciliationRunSchema,
  listDiscrepanciesForRunSchema,
  listDiscrepanciesSchema,
  listReconciliationRunsSchema,
  listUnresolvedDiscrepanciesSchema,
  resolveDiscrepancySchema,
  startReconciliationRunSchema,
} from "@/application/dto/reconciliation.dto";
import {
  makeGetDiscrepancyByIdUseCase,
  makeGetFinancialEntitySnapshotUseCase,
  makeGetReconciliationOverviewUseCase,
  makeGetReconciliationRunSeverityBreakdownUseCase,
  makeGetReconciliationRunUseCase,
  makeListDiscrepanciesForRunUseCase,
  makeListDiscrepanciesUseCase,
  makeListReconciliationRunsUseCase,
  makeListUnresolvedHighSeverityDiscrepanciesUseCase,
  makeResolveDiscrepancyUseCase,
  makeStartReconciliationRunUseCase,
  RECONCILIATION_PROVIDER_BINDING_LABEL,
} from "@/application/use-cases/reconciliation/compose";
import type { ReconciliationOverview } from "@/application/use-cases/reconciliation/get-reconciliation-overview.use-case";
import type { OpenSeverityCounts } from "@/domain/repositories/reconciliation-repository";
import { DomainError } from "@/domain/errors/domain-error";
import type { ReconciliationDiscrepancyRecord, ReconciliationRunRecord } from "@/domain/repositories/reconciliation-repository";
import type { ReconciliationRunSummary } from "@/application/use-cases/reconciliation/start-reconciliation-run.use-case";
import type { JobFinancialContext } from "@/domain/services/reconciliation/context";
import { ROLES, requireRole, getCurrentUser } from "@/infrastructure/auth/rbac";

/**
 * Module 80 — Financial Reconciliation & Observability: admin-only Server
 * Action adapters — same "requireRole first, business logic in the use
 * case" convention as admin/disputes/actions.ts. Every action requires
 * ADMIN/SUPER_ADMIN — reconciliation exposes the full financial lifecycle
 * across every customer/professional/company, so unlike some read-only
 * admin views this is never extended to SUPPORT.
 *
 * No unauthenticated route exists anywhere in Module 80 — this file (and
 * the use cases it calls) is the only entry point into starting a run,
 * reading a run/discrepancy, or resolving a discrepancy.
 */
export type ActionResult<T = undefined> = { success: true; data: T } | { success: false; error: string };

function fromDomainError<T>(error: unknown, fallback: string): ActionResult<T> {
  if (error instanceof DomainError) {
    return { success: false, error: error.message };
  }
  console.error(error);
  return { success: false, error: fallback };
}

export async function startReconciliationRunAction(input: Record<string, unknown> = {}): Promise<ActionResult<ReconciliationRunSummary>> {
  await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  const parsed = startReconciliationRunSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }
  try {
    const user = await getCurrentUser();
    const summary = await makeStartReconciliationRunUseCase().execute(parsed.data, user?.id ?? null);
    revalidatePath("/admin/reconciliation");
    revalidatePath("/admin/reconciliation/runs");
    return { success: true, data: summary };
  } catch (error) {
    return fromDomainError(error, "Something went wrong starting the reconciliation run.");
  }
}

export async function getReconciliationRunAction(runId: string): Promise<ActionResult<ReconciliationRunRecord>> {
  await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  const parsed = getReconciliationRunSchema.safeParse({ runId });
  if (!parsed.success) return { success: false, error: "Invalid run id." };
  try {
    const run = await makeGetReconciliationRunUseCase().execute(parsed.data.runId);
    return { success: true, data: run };
  } catch (error) {
    return fromDomainError(error, "Something went wrong loading this reconciliation run.");
  }
}

export async function listDiscrepanciesForRunAction(
  input: Record<string, unknown>,
): Promise<ActionResult<ReconciliationDiscrepancyRecord[]>> {
  await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  const parsed = listDiscrepanciesForRunSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }
  try {
    const list = await makeListDiscrepanciesForRunUseCase().execute(parsed.data.runId, parsed.data.limit, parsed.data.offset);
    return { success: true, data: list };
  } catch (error) {
    return fromDomainError(error, "Something went wrong loading discrepancies for this run.");
  }
}

export async function listUnresolvedHighSeverityDiscrepanciesAction(
  input: Record<string, unknown> = {},
): Promise<ActionResult<ReconciliationDiscrepancyRecord[]>> {
  await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  const parsed = listUnresolvedDiscrepanciesSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }
  try {
    const list = await makeListUnresolvedHighSeverityDiscrepanciesUseCase().execute(
      parsed.data.minSeverity,
      parsed.data.limit,
      parsed.data.offset,
    );
    return { success: true, data: list };
  } catch (error) {
    return fromDomainError(error, "Something went wrong loading unresolved discrepancies.");
  }
}

export async function resolveDiscrepancyAction(input: Record<string, unknown>): Promise<ActionResult<ReconciliationDiscrepancyRecord>> {
  const admin = await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  const parsed = resolveDiscrepancySchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }
  try {
    const resolved = await makeResolveDiscrepancyUseCase().execute(
      parsed.data.discrepancyId,
      admin.id,
      parsed.data.reason,
      parsed.data.metadata ?? null,
    );
    revalidatePath("/admin/reconciliation");
    revalidatePath("/admin/reconciliation/discrepancies");
    revalidatePath(`/admin/reconciliation/discrepancies/${parsed.data.discrepancyId}`);
    return { success: true, data: resolved };
  } catch (error) {
    return fromDomainError(error, "Something went wrong resolving this discrepancy.");
  }
}

export async function getFinancialEntitySnapshotAction(input: Record<string, unknown>): Promise<ActionResult<JobFinancialContext>> {
  await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  const parsed = getFinancialEntitySnapshotSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }
  try {
    const snapshot = await makeGetFinancialEntitySnapshotUseCase().execute(parsed.data.jobId);
    return { success: true, data: snapshot };
  } catch (error) {
    return fromDomainError(error, "Something went wrong loading this job's financial snapshot.");
  }
}


/**
 * Module 81 — Reconciliation Admin Dashboard & Operations: the admin
 * Runs list's own action. Same authorization/validation/error-translation
 * shape as every action above — this file's own doc comment on why every
 * export here requires ADMIN/SUPER_ADMIN still applies.
 */
export async function listReconciliationRunsAction(
  input: Record<string, unknown> = {},
): Promise<ActionResult<ReconciliationRunRecord[]>> {
  await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  const parsed = listReconciliationRunsSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }
  try {
    const list = await makeListReconciliationRunsUseCase().execute(parsed.data);
    return { success: true, data: list };
  } catch (error) {
    return fromDomainError(error, "Something went wrong loading reconciliation runs.");
  }
}

/**
 * Module 81 — the admin Discrepancies investigation table's filtered
 * query (resolution status, severity, category, entity type, detected-at
 * date range).
 */
export async function listDiscrepanciesAction(
  input: Record<string, unknown> = {},
): Promise<ActionResult<ReconciliationDiscrepancyRecord[]>> {
  await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  const parsed = listDiscrepanciesSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }
  try {
    const list = await makeListDiscrepanciesUseCase().execute(parsed.data);
    return { success: true, data: list };
  } catch (error) {
    return fromDomainError(error, "Something went wrong loading discrepancies.");
  }
}

/** Module 81 — every figure the admin overview page renders, in one call. */
export async function getReconciliationOverviewAction(): Promise<ActionResult<ReconciliationOverview>> {
  await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  try {
    const overview = await makeGetReconciliationOverviewUseCase().execute();
    return { success: true, data: overview };
  } catch (error) {
    return fromDomainError(error, "Something went wrong loading the reconciliation overview.");
  }
}

/**
 * Module 81 — which `ProviderFinancialReconciliationPort` implementation
 * this deployment is bound to (see `compose.ts`'s own doc comment on
 * `RECONCILIATION_PROVIDER_BINDING_LABEL`). Read-only, no input; still
 * gated by the same ADMIN/SUPER_ADMIN role check as everything else in
 * this file, since it is only ever rendered inside the admin reconciliation
 * dashboard.
 */
export async function getReconciliationProviderBindingAction(): Promise<ActionResult<{ label: string }>> {
  await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  return { success: true, data: { label: RECONCILIATION_PROVIDER_BINDING_LABEL } };
}

/** Module 81 — the run detail page's severity-breakdown section. */
export async function getReconciliationRunSeverityBreakdownAction(runId: string): Promise<ActionResult<OpenSeverityCounts>> {
  await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  const parsed = getReconciliationRunSchema.safeParse({ runId });
  if (!parsed.success) return { success: false, error: "Invalid run id." };
  try {
    const breakdown = await makeGetReconciliationRunSeverityBreakdownUseCase().execute(parsed.data.runId);
    return { success: true, data: breakdown };
  } catch (error) {
    return fromDomainError(error, "Something went wrong loading this run's severity breakdown.");
  }
}

/** Module 81 — the discrepancy detail page's single-record lookup — see `GetDiscrepancyByIdUseCase`'s own doc comment. */
export async function getReconciliationDiscrepancyAction(discrepancyId: string): Promise<ActionResult<ReconciliationDiscrepancyRecord>> {
  await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  const parsed = getDiscrepancySchema.safeParse({ discrepancyId });
  if (!parsed.success) return { success: false, error: "Invalid discrepancy id." };
  try {
    const discrepancy = await makeGetDiscrepancyByIdUseCase().execute(parsed.data.discrepancyId);
    return { success: true, data: discrepancy };
  } catch (error) {
    return fromDomainError(error, "Something went wrong loading this discrepancy.");
  }
}
