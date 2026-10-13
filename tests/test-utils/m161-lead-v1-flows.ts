/**
 * Module 161 — shared flow helpers that go through the REAL composition roots (tests only).
 * Importing this file pulls in the compose modules, so a test file must install its `vi.mock` calls (payment gateway, logger,
 * e-mail) BEFORE importing it - exactly like the E2E file does.
 */
import { makeInitiateLeadFeePaymentUseCase } from "@/application/use-cases/lead-fee-payment/compose";
import { makeInitiateLeadPurchaseUseCase } from "@/application/use-cases/lead-purchase/compose";
import { makeSubmitLeadRequestUseCase } from "@/application/use-cases/lead-request/compose";
import { prisma } from "@/infrastructure/database/prisma/client";
import { resolveLeadPricingProductionConfig } from "@/infrastructure/pricing/lead-pricing-production-config-resolver";

import { REQUEST_INPUT, seedCustomer, seedProfessional, type SeededProfessional } from "./m161-lead-v1-world";

export const PILOT_PRICING = () => resolveLeadPricingProductionConfig("lead-pricing-pilot-v1");

/** fontaneria pilot price: 150.00 x 0.12 = 18.00 fee + 21% IVA = 21.78 -> 2178 minor units. */
export const PILOT_TOTAL_MINOR_UNITS = 2178;

/** A new customer submits a request through the real ENABLED submit root; returns the PUBLISHED lead. */
export async function submitPublishedLead(category: { id: string }) {
  const customer = await seedCustomer(prisma);
  const submitted = await makeSubmitLeadRequestUseCase(PILOT_PRICING()).execute(customer.userId, REQUEST_INPUT(category.id));
  if (submitted.publication !== "PUBLISHED") throw new Error("test setup: lead was not published");
  const lead = await prisma.lead.findFirstOrThrow({ where: { serviceRequestId: submitted.receipt.requestId } });
  const { address } = await prisma.serviceRequest.findUniqueOrThrow({ where: { id: submitted.receipt.requestId }, select: { address: { select: { latitude: true, longitude: true } } } });
  // Fail loudly and precisely if the precondition every purchase depends on is missing (instead of a downstream "not purchasable").
  if (address.latitude === null || address.longitude === null) throw new Error("test setup: the published request has no coordinates, so no professional can be eligible");
  return { customer, lead };
}

export async function seedProfessionals(category: { id: string }, count: number): Promise<SeededProfessional[]> {
  const out: SeededProfessional[] = [];
  for (let i = 0; i < count; i += 1) out.push(await seedProfessional(prisma, { categoryId: category.id }));
  return out;
}

/** purchase (PENDING_PAYMENT) + a provider payment attempt; returns the purchase id and the provider reference. */
export async function purchaseWithPaymentAttempt(pro: SeededProfessional, leadId: string) {
  const purchase = await makeInitiateLeadPurchaseUseCase().execute(pro.userId, leadId);
  await makeInitiateLeadFeePaymentUseCase().execute(pro.userId, purchase.purchaseId);
  const row = await prisma.leadPurchase.findUniqueOrThrow({ where: { id: purchase.purchaseId } });
  return { purchaseId: purchase.purchaseId, reference: row.paymentReference as string };
}

export const settle = <T>(promises: Array<Promise<T>>) => Promise.allSettled(promises);
export const fulfilled = <T>(results: Array<PromiseSettledResult<T>>) => results.filter((r): r is PromiseFulfilledResult<T> => r.status === "fulfilled");
export const rejected = (results: Array<PromiseSettledResult<unknown>>) => results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
