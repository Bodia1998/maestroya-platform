/**
 * Module 91 — Real-Database Integration Test Harness.
 *
 * Minimal, real-Postgres entity-graph builders for the real-DB test tier.
 * Every helper here does a genuine `prisma.<model>.create` against the
 * database resolved by `test-database-url.ts` — there is no fake/mock
 * anywhere in this file. Financial rows (`Payment`, `Commission`,
 * `Payout`, `Transaction`, ...) all sit at the end of a real FK chain
 * (`User` -> `Address`/`CustomerProfile`/`ProfessionalProfile` ->
 * `ServiceCategory` -> `ServiceRequest` -> `Quote` -> `Job`), so these
 * helpers exist to build that chain once, with sane defaults, rather
 * than every test re-deriving it by hand.
 *
 * Each helper accepts a `Partial<...>` overrides object so a test can
 * still control exactly the field it's asserting on (e.g. a specific
 * `stripePaymentIntentId` for the payment-uniqueness test) without
 * having to specify every other required field itself.
 */
import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

function uniqueSuffix(): string {
  return randomUUID().slice(0, 8);
}

export async function createUser(
  prisma: PrismaClient,
  overrides: Partial<{ id: string; name: string; email: string }> = {},
) {
  return prisma.user.create({
    data: {
      id: overrides.id,
      name: overrides.name ?? `Module 91 Test User ${uniqueSuffix()}`,
      email: overrides.email ?? `module91-${uniqueSuffix()}@test.maestroya.invalid`,
      status: "ACTIVE",
    },
  });
}

export async function createAddress(
  prisma: PrismaClient,
  userId: string,
  overrides: Partial<{ id: string; city: string }> = {},
) {
  return prisma.address.create({
    data: {
      id: overrides.id,
      userId,
      type: "HOME",
      line1: "Calle de Prueba 1",
      city: overrides.city ?? "Valencia",
      postalCode: "46001",
      country: "ES",
    },
  });
}

export async function createCustomerProfile(prisma: PrismaClient, userId: string, overrides: Partial<{ id: string }> = {}) {
  return prisma.customerProfile.create({
    data: { id: overrides.id, userId },
  });
}

export async function createProfessionalProfile(
  prisma: PrismaClient,
  userId: string,
  overrides: Partial<{ id: string }> = {},
) {
  return prisma.professionalProfile.create({
    data: { id: overrides.id, userId, status: "ACTIVE", verificationStatus: "VERIFIED" },
  });
}

export async function createServiceCategory(prisma: PrismaClient, overrides: Partial<{ id: string; name: string; slug: string }> = {}) {
  const suffix = uniqueSuffix();
  return prisma.serviceCategory.create({
    data: {
      id: overrides.id,
      name: overrides.name ?? `Module 91 Category ${suffix}`,
      slug: overrides.slug ?? `module-91-category-${suffix}`,
      status: "ACTIVE",
    },
  });
}

export async function createServiceRequest(
  prisma: PrismaClient,
  input: { customerId: string; categoryId: string; addressId: string },
  overrides: Partial<{ id: string; title: string }> = {},
) {
  return prisma.serviceRequest.create({
    data: {
      id: overrides.id,
      customerId: input.customerId,
      categoryId: input.categoryId,
      addressId: input.addressId,
      title: overrides.title ?? "Module 91 test service request",
      description: "Seeded by the Module 91 real-DB integration test harness.",
      status: "PUBLISHED",
    },
  });
}

export async function createQuote(
  prisma: PrismaClient,
  input: { serviceRequestId: string; professionalProfileId: string; submittedByUserId: string },
  overrides: Partial<{ id: string; totalAmount: number }> = {},
) {
  return prisma.quote.create({
    data: {
      id: overrides.id,
      serviceRequestId: input.serviceRequestId,
      professionalProfileId: input.professionalProfileId,
      submittedByUserId: input.submittedByUserId,
      status: "ACCEPTED",
      totalAmount: overrides.totalAmount ?? 100,
    },
  });
}

export async function createJob(
  prisma: PrismaClient,
  input: { serviceRequestId: string; quoteId: string; customerId: string; professionalProfileId: string },
  overrides: Partial<{ id: string; status: "CREATED" | "IN_PROGRESS" | "COMPLETED" }> = {},
) {
  return prisma.job.create({
    data: {
      id: overrides.id,
      serviceRequestId: input.serviceRequestId,
      quoteId: input.quoteId,
      customerId: input.customerId,
      professionalProfileId: input.professionalProfileId,
      status: overrides.status ?? "COMPLETED",
    },
  });
}

/**
 * The full real FK chain a `Payment`/`Payout` needs to exist, built in
 * one call: a customer `User` + `CustomerProfile` + `Address`, a
 * professional `User` + `ProfessionalProfile`, a `ServiceCategory`, and
 * the `ServiceRequest` -> `Quote` -> `Job` chain connecting them.
 *
 * This is the graph every financial-invariant test in this suite starts
 * from — see e.g. `payment-uniqueness.test.ts`, which then creates its
 * own `Payment` row(s) against `serviceRequestId`/`quoteId`/`payerId`
 * from this return value.
 */
export async function createFinancialGraph(prisma: PrismaClient) {
  const customerUser = await createUser(prisma, { name: "Module 91 Customer" });
  const address = await createAddress(prisma, customerUser.id);
  const customerProfile = await createCustomerProfile(prisma, customerUser.id);

  const professionalUser = await createUser(prisma, { name: "Module 91 Professional" });
  const professionalProfile = await createProfessionalProfile(prisma, professionalUser.id);

  const category = await createServiceCategory(prisma);

  const serviceRequest = await createServiceRequest(prisma, {
    customerId: customerProfile.id,
    categoryId: category.id,
    addressId: address.id,
  });

  const quote = await createQuote(prisma, {
    serviceRequestId: serviceRequest.id,
    professionalProfileId: professionalProfile.id,
    submittedByUserId: professionalUser.id,
  });

  const job = await createJob(prisma, {
    serviceRequestId: serviceRequest.id,
    quoteId: quote.id,
    customerId: customerProfile.id,
    professionalProfileId: professionalProfile.id,
  });

  return {
    payerUserId: customerUser.id,
    customerProfileId: customerProfile.id,
    professionalUserId: professionalUser.id,
    professionalProfileId: professionalProfile.id,
    categoryId: category.id,
    addressId: address.id,
    serviceRequestId: serviceRequest.id,
    quoteId: quote.id,
    jobId: job.id,
  };
}

export async function createCapturedPayment(
  prisma: PrismaClient,
  graph: Pick<Awaited<ReturnType<typeof createFinancialGraph>>, "serviceRequestId" | "quoteId" | "payerUserId">,
  overrides: Partial<{ id: string; amount: number; stripePaymentIntentId: string }> = {},
) {
  return prisma.payment.create({
    data: {
      id: overrides.id,
      serviceRequestId: graph.serviceRequestId,
      quoteId: graph.quoteId,
      payerId: graph.payerUserId,
      amount: overrides.amount ?? 100,
      method: "CARD",
      status: "CAPTURED",
      capturedAt: new Date(),
      stripePaymentIntentId: overrides.stripePaymentIntentId ?? `pi_module91_${uniqueSuffix()}`,
    },
  });
}

export async function createReconciliationRun(prisma: PrismaClient, overrides: Partial<{ id: string }> = {}) {
  return prisma.reconciliationRun.create({
    data: {
      id: overrides.id,
      scope: "FULL",
      status: "COMPLETED",
      startedAt: new Date(),
      completedAt: new Date(),
      parametersHash: `module91-${uniqueSuffix()}`,
    },
  });
}
