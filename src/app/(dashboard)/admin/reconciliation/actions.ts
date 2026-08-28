"use server";

import {
  getFinancialEntitySnapshotSchema,
  getReconciliationRunSchema,
  listDiscrepanciesForRunSchema,
  listUnresolvedDiscrepanciesSchema,
  resolveDiscrepancySchema,
  startReconciliationRunSchema,
} from "@/application/dto/reconciliation.dto";
import {
  makeGetFinancialEntitySnapshotUseCase,
  makeGetReconciliationRunUseCase,
  makeListDiscrepanciesForRunUseCase,
  makeListUnresolvedHighSeverityDiscrepanciesUseCase,
  makeResolveDiscrepancyUseCase,
  makeStartReconciliationRunUseCase,
} from "@/application/use-cases/reconciliation/compose";
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
