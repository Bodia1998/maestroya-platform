import { GetMaterialsStatisticsUseCase } from "@/application/use-cases/materials/get-materials-statistics.use-case";

/**
 * Module 63 — Materials Procurement Workflow. `ConfirmMaterialsPurchasedUseCase`
 * lives in, and is composed from, `use-cases/quotes/compose.ts` instead —
 * it operates on the Quote aggregate root, the same "child capability
 * composed alongside its aggregate root's other use cases" convention
 * `AcceptQuoteUseCase` already follows. This file only composes the
 * module's standalone reporting use case.
 */
export function makeGetMaterialsStatisticsUseCase() {
  return new GetMaterialsStatisticsUseCase();
}
