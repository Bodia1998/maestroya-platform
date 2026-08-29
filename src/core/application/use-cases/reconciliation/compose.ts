import "server-only";

import { eventBus } from "@/infrastructure/events/compose";
import { createFailureReporter } from "@/infrastructure/observability/failure-reporter-factory";
import { PrismaReconciliationRunRepository } from "@/infrastructure/database/prisma/repositories/prisma-reconciliation-run-repository";
import { PrismaReconciliationDiscrepancyRepository } from "@/infrastructure/database/prisma/repositories/prisma-reconciliation-discrepancy-repository";
import { PrismaReconciliationDataSource } from "@/infrastructure/database/prisma/repositories/prisma-reconciliation-data-source";
import { PrismaAdminAuditLogRepository } from "@/infrastructure/database/prisma/repositories/prisma-admin-audit-log-repository";
import { NullProviderReconciliationAdapter } from "@/infrastructure/payments/null-provider-reconciliation-adapter";
import { StripeProviderReconciliationAdapter } from "@/infrastructure/payments/stripe/stripe-provider-reconciliation-adapter";
import { StartReconciliationRunUseCase } from "./start-reconciliation-run.use-case";
import { GetReconciliationRunUseCase } from "./get-reconciliation-run.use-case";
import { ListDiscrepanciesForRunUseCase } from "./list-discrepancies-for-run.use-case";
import { ListUnresolvedHighSeverityDiscrepanciesUseCase } from "./list-unresolved-high-severity-discrepancies.use-case";
import { ResolveDiscrepancyUseCase } from "./resolve-discrepancy.use-case";
import { GetFinancialEntitySnapshotUseCase } from "./get-financial-entity-snapshot.use-case";
import { ListReconciliationRunsUseCase } from "./list-reconciliation-runs.use-case";
import { ListDiscrepanciesUseCase } from "./list-discrepancies.use-case";
import { GetReconciliationOverviewUseCase } from "./get-reconciliation-overview.use-case";
import { GetReconciliationRunSeverityBreakdownUseCase } from "./get-reconciliation-run-severity-breakdown.use-case";
import { GetDiscrepancyByIdUseCase } from "./get-discrepancy-by-id.use-case";
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

// Module 81 — Reconciliation Admin Dashboard & Operations: the three
// read-only use cases the admin UI needs that Module 80 hadn't composed a
// factory for yet (the runs list, the filterable discrepancies table, and
// the overview aggregate) — same manual-wiring convention as every
// factory above, no new dependency introduced.
export function makeListReconciliationRunsUseCase(): ListReconciliationRunsUseCase {
  return new ListReconciliationRunsUseCase(runs);
}

export function makeListDiscrepanciesUseCase(): ListDiscrepanciesUseCase {
  return new ListDiscrepanciesUseCase(discrepancies);
}

export function makeGetReconciliationOverviewUseCase(): GetReconciliationOverviewUseCase {
  return new GetReconciliationOverviewUseCase(runs, discrepancies);
}

export function makeGetReconciliationRunSeverityBreakdownUseCase(): GetReconciliationRunSeverityBreakdownUseCase {
  return new GetReconciliationRunSeverityBreakdownUseCase(discrepancies);
}

export function makeGetDiscrepancyByIdUseCase(): GetDiscrepancyByIdUseCase {
  return new GetDiscrepancyByIdUseCase(discrepancies);
}

/**
 * Module 81 — Reconciliation Admin Dashboard & Operations: a human-facing
 * label for which `ProviderFinancialReconciliationPort` binding is
 * currently active (see this file's own top-of-file doc comment on the
 * Null -> Stripe migration path), surfaced on the admin overview so an
 * operator can tell whether "0 provider discrepancies" means "nothing
 * wrong" or "provider reconciliation isn't wired to a real gateway yet."
 * Not a use case — there is no domain/application logic here, only a
 * static read of which infrastructure class this composition root
 * instantiated, so a dedicated use case would add a layer without adding
 * a rule; `actions.ts` reads this constant directly, same as any other
 * composition-root constant.
 */
export const RECONCILIATION_PROVIDER_BINDING_LABEL =
  provider instanceof StripeProviderReconciliationAdapter ? "Stripe" : "Null adapter (not connected to a live provider)";

const runAuditLogSubscriber = new RecordReconciliationRunAuditLogSubscriber(auditLog);
eventBus.subscribe(ReconciliationRunStarted, runAuditLogSubscriber);
eventBus.subscribe(ReconciliationRunCompleted, runAuditLogSubscriber);
eventBus.subscribe(ReconciliationRunFailed, runAuditLogSubscriber);
eventBus.subscribe(DiscrepancyResolved, new RecordDiscrepancyResolutionAuditLogSubscriber(auditLog));
