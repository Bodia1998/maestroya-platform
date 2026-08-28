import "server-only";

import { eventBus } from "@/infrastructure/events/compose";
import { createFailureReporter } from "@/infrastructure/observability/failure-reporter-factory";
import { PrismaReconciliationRunRepository } from "@/infrastructure/database/prisma/repositories/prisma-reconciliation-run-repository";
import { PrismaReconciliationDiscrepancyRepository } from "@/infrastructure/database/prisma/repositories/prisma-reconciliation-discrepancy-repository";
import { PrismaReconciliationDataSource } from "@/infrastructure/database/prisma/repositories/prisma-reconciliation-data-source";
import { PrismaAdminAuditLogRepository } from "@/infrastructure/database/prisma/repositories/prisma-admin-audit-log-repository";
import { NullProviderReconciliationAdapter } from "@/infrastructure/payments/null-provider-reconciliation-adapter";
import { StartReconciliationRunUseCase } from "./start-reconciliation-run.use-case";
import { GetReconciliationRunUseCase } from "./get-reconciliation-run.use-case";
import { ListDiscrepanciesForRunUseCase } from "./list-discrepancies-for-run.use-case";
import { ListUnresolvedHighSeverityDiscrepanciesUseCase } from "./list-unresolved-high-severity-discrepancies.use-case";
import { ResolveDiscrepancyUseCase } from "./resolve-discrepancy.use-case";
import { GetFinancialEntitySnapshotUseCase } from "./get-financial-entity-snapshot.use-case";
import {
  RecordDiscrepancyResolutionAuditLogSubscriber,
  RecordReconciliationRunAuditLogSubscriber,
} from "./record-reconciliation-audit-log.subscriber";
import { ReconciliationRunStarted } from "@/domain/events/reconciliation-run-started";
import { ReconciliationRunCompleted } from "@/domain/events/reconciliation-run-completed";
import { ReconciliationRunFailed } from "@/domain/events/reconciliation-run-failed";
import { DiscrepancyResolved } from "@/domain/events/discrepancy-resolved";

/**
 * Module 80 — Financial Reconciliation & Observability.
 *
 * Composition root — same manual-wiring convention as every other
 * `compose.ts` in this codebase (see `invoicing/compose.ts`'s own doc
 * comment).
 *
 * ## Provider reconciliation binding
 * `NullProviderReconciliationAdapter` is the default binding, exactly
 * mirroring `infrastructure/payments/compose.ts`'s own original
 * `NullPaymentGateway` -> `StripePaymentGatewayAdapter` migration path
 * (see that file's doc comment: "Module 73 is the only file that changes
 * to go from Null... to a real implementation"). Switching to
 * `StripeProviderReconciliationAdapter` (backed by the same shared
 * `stripe` SDK client singleton every other Stripe adapter already uses)
 * is a one-line change here — see
 * `MODULE_80_IMPLEMENTATION_REPORT.md`, "Remaining risks," for why this
 * has been left on the Null binding rather than switched by this
 * implementation itself (no live Stripe verification was performed in
 * this environment).
 */
const runs = new PrismaReconciliationRunRepository();
const discrepancies = new PrismaReconciliationDiscrepancyRepository();
const dataSource = new PrismaReconciliationDataSource();
const auditLog = new PrismaAdminAuditLogRepository();
const provider = new NullProviderReconciliationAdapter();
const failureReporter = createFailureReporter();

export function makeStartReconciliationRunUseCase(): StartReconciliationRunUseCase {
  return new StartReconciliationRunUseCase(dataSource, runs, discrepancies, provider, eventBus, failureReporter);
}

export function makeGetReconciliationRunUseCase(): GetReconciliationRunUseCase {
  return new GetReconciliationRunUseCase(runs);
}

export function makeListDiscrepanciesForRunUseCase(): ListDiscrepanciesForRunUseCase {
  return new ListDiscrepanciesForRunUseCase(discrepancies);
}

export function makeListUnresolvedHighSeverityDiscrepanciesUseCase(): ListUnresolvedHighSeverityDiscrepanciesUseCase {
  return new ListUnresolvedHighSeverityDiscrepanciesUseCase(discrepancies);
}

export function makeResolveDiscrepancyUseCase(): ResolveDiscrepancyUseCase {
  return new ResolveDiscrepancyUseCase(discrepancies, eventBus, failureReporter);
}

export function makeGetFinancialEntitySnapshotUseCase(): GetFinancialEntitySnapshotUseCase {
  return new GetFinancialEntitySnapshotUseCase(dataSource);
}

const runAuditLogSubscriber = new RecordReconciliationRunAuditLogSubscriber(auditLog);
eventBus.subscribe(ReconciliationRunStarted, runAuditLogSubscriber);
eventBus.subscribe(ReconciliationRunCompleted, runAuditLogSubscriber);
eventBus.subscribe(ReconciliationRunFailed, runAuditLogSubscriber);
eventBus.subscribe(DiscrepancyResolved, new RecordDiscrepancyResolutionAuditLogSubscriber(auditLog));
