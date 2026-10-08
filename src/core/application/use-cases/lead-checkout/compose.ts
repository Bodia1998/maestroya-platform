import { GetLeadPurchaseCheckoutUseCase } from "@/application/use-cases/lead-checkout/get-lead-purchase-checkout.use-case";
import { PrismaLeadPurchaseRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-purchase-repository";
import { PrismaLeadRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-repository";
import { PrismaProfessionalRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-repository";

/**
 * Module 144 — the EXISTING M126/M135 purchase-initiation factory, re-exported unchanged so the checkout
 * Server Action reaches it through this module. `lead-purchase/compose.ts` itself also holds the trusted
 * lifecycle factories (confirm / transition), which Module 139's contract keeps out of every file under
 * `src/app`; this re-export exposes ONLY the initiation factory and wires nothing new (no second purchase
 * use case, no duplicated composition).
 */
export { makeInitiateLeadPurchaseUseCase } from "@/application/use-cases/lead-purchase/compose";

/**
 * Module 144 — composition root of the READ-ONLY checkout state lookup (plain factory, same
 * convention as the other compose.ts files). Deliberately separate from
 * `lead-purchase/compose.ts` (trusted lifecycle factories) and `lead-fee-payment/compose.ts`
 * (payment initiation): this one can only read.
 */
export function makeGetLeadPurchaseCheckoutUseCase() {
  return new GetLeadPurchaseCheckoutUseCase(new PrismaProfessionalRepository(), new PrismaLeadRepository(), new PrismaLeadPurchaseRepository());
}
