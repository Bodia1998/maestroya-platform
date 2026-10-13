/**
 * Module 161 — shared fixtures for the LEAD_V1 end-to-end / concurrency / rollout verification (tests only).
 *
 * Everything here talks to the REAL guarded test database through the real Prisma client and repositories. The only
 * simulated collaborators are the payment provider (`m161Gateway`, the deterministic in-memory lead-fee gateway the
 * project already uses in M140/M153) and, where a test file says so, the e-mail transport. Nothing here performs a
 * network call, reads `.env*`, or prints a credential.
 */
import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";
import Stripe from "stripe";

import type { PrismaClient } from "@prisma/client";

import { VerifyBillingIdentityUseCase } from "@/application/use-cases/billing-identity/review-billing-identity.use-cases";
import { assertValidBillingIdentityDetails } from "@/domain/services/professional-billing-identity";
import { PrismaProfessionalBillingIdentityRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-billing-identity-repository";

import { FakeLeadFeePaymentGateway } from "./fake-lead-fee-payment-gateway";
import { createAddress, createProfessionalProfile, createServiceCategory, createUser } from "./db/seed-helpers";

/**
 * The simulated payment provider shared by every M161 test file (installed through `vi.mock` in each file). A holder, so each
 * test can start from a pristine in-memory provider via `resetM161Gateway()` while the already-imported composition roots
 * keep resolving whatever is current.
 */
export const m161Gateway: { current: FakeLeadFeePaymentGateway } = { current: new FakeLeadFeePaymentGateway() };
export function resetM161Gateway(): FakeLeadFeePaymentGateway {
  m161Gateway.current = new FakeLeadFeePaymentGateway();
  return m161Gateway.current;
}

/** Valencia — inside the static geocoder's known cities, so a request created through the real use case gets coordinates. */
export const VALENCIA = { latitude: 39.4699, longitude: -0.3763 } as const;

export const BILLING_DETAILS = {
  entityType: "COMPANY",
  legalName: "Fontanería Mediterránea S.L.",
  taxId: "B12345674",
  taxCountry: "ES",
  addressLine1: "Carrer Major 12",
  city: "Gandia",
  region: "Valencia",
  postalCode: "46700",
  country: "ES",
} as const;

let counter = 0;
/** Process-unique, collision-free suffix: parallel workers and repeated runs can never share an e-mail / phone / tax id. */
export function uniq(): string {
  counter += 1;
  return `${process.pid}${Date.now().toString(36)}${counter}${randomUUID().slice(0, 4)}`;
}

export interface SeededCustomer {
  userId: string;
  email: string;
  phone: string;
  name: string;
}

/** A customer USER only: the real submit use case creates the CustomerProfile, Address, ServiceRequest and Lead itself. */
export async function seedCustomer(prisma: PrismaClient): Promise<SeededCustomer> {
  const tag = uniq();
  const email = `m161-customer-${tag}@test.maestroya.invalid`;
  const phone = `+346${String(Math.abs(hash(tag))).padStart(8, "0").slice(0, 8)}`;
  const name = `M161 Customer ${tag}`;
  const user = await createUser(prisma, { name, email });
  await prisma.user.update({ where: { id: user.id }, data: { phone } });
  return { userId: user.id, email, phone, name };
}

function hash(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) h = (h * 31 + value.charCodeAt(i)) | 0;
  return h;
}

export async function seedCategory(prisma: PrismaClient, slug = "fontaneria") {
  return createServiceCategory(prisma, { name: `M161 ${slug}`, slug });
}

export interface SeededProfessional {
  userId: string;
  profileId: string;
}

/**
 * A professional who is eligible by every real gate: ACTIVE + VERIFIED (M98), serves `categoryId` from a default address with
 * coordinates inside the request's radius, and (unless `billing: false`) has admin-VERIFIED billing details (M146/M147).
 */
export async function seedProfessional(
  prisma: PrismaClient,
  options: { categoryId: string; billing?: boolean },
): Promise<SeededProfessional> {
  const user = await createUser(prisma, { name: `M161 Pro ${uniq()}` });
  const address = await createAddress(prisma, user.id, { city: "Valencia" });
  await prisma.address.update({ where: { id: address.id }, data: { latitude: VALENCIA.latitude, longitude: VALENCIA.longitude, isDefault: true } });
  const profile = await createProfessionalProfile(prisma, user.id);
  await prisma.professionalProfile.update({
    where: { id: profile.id },
    data: { serviceRadiusKm: 60, categories: { connect: [{ id: options.categoryId }] } },
  });
  if (options.billing !== false) {
    const identities = new PrismaProfessionalBillingIdentityRepository();
    const admin = await createUser(prisma, { name: `M161 Billing Reviewer ${uniq()}` });
    const { record } = await identities.saveDetails(profile.id, assertValidBillingIdentityDetails(BILLING_DETAILS));
    await new VerifyBillingIdentityUseCase(identities).execute(admin.id, { identityId: record.id, expectedRevision: record.revision });
  }
  return { userId: user.id, profileId: profile.id };
}

export async function seedAdmin(prisma: PrismaClient): Promise<string> {
  const user = await createUser(prisma, { name: `M161 Admin ${uniq()}` });
  const role = await prisma.role.upsert({ where: { key: "ADMIN" }, update: {}, create: { key: "ADMIN", name: "ADMIN" } });
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  return user.id;
}

/**
 * The request carries EXPLICIT coordinates (the documented "explicit client coordinates win" rule in
 * `CreateLeadV1ServiceRequestUseCase`). Without them the use case falls back to the configured geocoding provider, which is
 * best-effort by design (`SafeGeocodingProvider` swallows failures into `null`) and is chosen by `GEOCODING_PROVIDER`. A
 * developer environment that selects a network/API-key provider would then persist a request with NULL coordinates, which
 * makes every professional ineligible (`isProfessionalEligibleForRequest`) and the whole suite fail upstream of the code
 * under test. M161 verifies purchase/payment/concurrency behaviour, so it must not depend on an external geocoder.
 */
export const REQUEST_INPUT = (categoryId: string) => ({
  categoryId,
  title: "Fuga de agua bajo el fregadero",
  description: "Hay una fuga de agua constante bajo el fregadero de la cocina y necesito que alguien la revise.",
  urgency: "MEDIUM" as const,
  location: { line1: "Calle de la Paz 1", city: "Valencia", province: "Valencia", postalCode: "46003", country: "ES", latitude: VALENCIA.latitude, longitude: VALENCIA.longitude },
});

// ---------------------------------------------------------------------------------------------------------------------
// Signed webhook requests — the REAL `/api/webhooks/stripe-payments` route, the REAL verifier (HMAC over the raw body).
// The signature is computed locally with the configured test secret; no network and no Stripe account is involved.
// ---------------------------------------------------------------------------------------------------------------------

let eventSeq = 0;
export function nextEventId(prefix = "evt_m161"): string {
  eventSeq += 1;
  return `${prefix}_${uniq()}_${eventSeq}`;
}

export function paymentIntentEvent(input: {
  id?: string;
  type?: "payment_intent.succeeded" | "payment_intent.payment_failed" | "payment_intent.canceled";
  paymentIntentId: string;
  amountMinorUnits: number;
  currency?: string;
  leadPurchaseId?: string | null;
  leadId?: string | null;
}) {
  return {
    id: input.id ?? nextEventId(),
    object: "event",
    api_version: "2024-12-18.acacia",
    created: Math.floor(Date.now() / 1000),
    type: input.type ?? "payment_intent.succeeded",
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    data: {
      object: {
        id: input.paymentIntentId,
        object: "payment_intent",
        amount: input.amountMinorUnits,
        currency: input.currency ?? "eur",
        metadata: { flow: "LEAD_V1", leadPurchaseId: input.leadPurchaseId ?? "", leadId: input.leadId ?? "" },
        last_payment_error: input.type === "payment_intent.payment_failed" ? { message: "card_declined" } : null,
      },
    },
  };
}

export function disputeEvent(input: {
  id?: string;
  type?: "charge.dispute.created" | "charge.dispute.updated" | "charge.dispute.closed";
  disputeId: string;
  paymentIntentId: string;
  amountMinorUnits: number;
  status: string;
  currency?: string;
}) {
  return {
    id: input.id ?? nextEventId("evt_m161_dp"),
    object: "event",
    api_version: "2024-12-18.acacia",
    created: Math.floor(Date.now() / 1000),
    type: input.type ?? "charge.dispute.created",
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    data: {
      object: {
        id: input.disputeId,
        object: "dispute",
        charge: `ch_${input.disputeId}`,
        payment_intent: input.paymentIntentId,
        amount: input.amountMinorUnits,
        currency: input.currency ?? "eur",
        reason: "fraudulent",
        status: input.status,
        evidence_details: { due_by: Math.floor(Date.now() / 1000) + 7 * 86400 },
      },
    },
  };
}

export function signedWebhookRequest(event: object, options: { secret?: string; tamper?: boolean } = {}): NextRequest {
  const payload = JSON.stringify(event);
  const secret = options.secret ?? process.env.STRIPE_PAYMENTS_WEBHOOK_SECRET ?? "";
  const header = new Stripe("sk_test_placeholder").webhooks.generateTestHeaderString({ payload, secret });
  return new NextRequest("http://localhost/api/webhooks/stripe-payments", {
    method: "POST",
    body: options.tamper ? `${payload} ` : payload,
    headers: { "stripe-signature": header, "content-type": "application/json" },
  });
}

/** Pulls the `status` label out of a webhook route response (the route returns only an outcome label + request id). */
export async function webhookOutcome(response: Response): Promise<{ http: number; status: string | null }> {
  const body = (await response.json().catch(() => ({}))) as { status?: string };
  return { http: response.status, status: body.status ?? null };
}
