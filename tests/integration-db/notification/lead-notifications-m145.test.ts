/**
 * Module 145 — LEAD_V1 lead notifications against REAL PostgreSQL.
 *
 * Proves what mocks cannot:
 *  - the (userId, dedupeKey) idempotency is enforced by the DATABASE (unique index), including
 *    under genuinely concurrent inserts, while pre-M145 / non-idempotent rows stay unconstrained;
 *  - the authoritative M141 webhook -> domain event -> subscriber -> dispatcher -> `notifications`
 *    row chain, with recipients resolved from persisted relations only;
 *  - repeated / concurrent / re-delivered webhooks never create a second user-visible notification;
 *  - non-success lifecycle states, legacy-flow records and cross-user cases produce nothing;
 *  - no contact data, payment reference or internal purchase id is ever persisted in a notification.
 */
import { describe, expect, it, vi } from "vitest";

import type { StripePaymentWebhookEvent } from "@/application/ports/stripe-payment-webhook-verifier";
import { LeadPublished } from "@/domain/events/lead-published";
import { LeadPurchaseCancelled } from "@/domain/events/lead-purchase-cancelled";
import { LeadPurchaseConfirmed } from "@/domain/events/lead-purchase-confirmed";
import { PublishLeadUseCase } from "@/application/use-cases/lead/publish-lead.use-case";
import { ProcessLeadFeePaymentWebhookUseCase } from "@/application/use-cases/lead-fee-payment/process-lead-fee-payment-webhook.use-case";
import { ConfirmLeadPurchaseUseCase } from "@/application/use-cases/lead-purchase/confirm-lead-purchase.use-case";
import { TransitionLeadPurchaseUseCase } from "@/application/use-cases/lead-purchase/transition-lead-purchase.use-case";
import { NotifyLeadPublishedSubscriber } from "@/application/use-cases/notification/notify-lead-published.subscriber";
import { NotifyLeadPurchaseCancelledSubscriber } from "@/application/use-cases/notification/notify-lead-purchase-cancelled.subscriber";
import { NotifyLeadPurchaseConfirmedSubscriber } from "@/application/use-cases/notification/notify-lead-purchase-confirmed.subscriber";
import { prisma } from "@/infrastructure/database/prisma/client";
import { PrismaCustomerProfileRepository } from "@/infrastructure/database/prisma/repositories/prisma-customer-profile-repository";
import { PrismaExternalWebhookEventRepository } from "@/infrastructure/database/prisma/repositories/prisma-external-webhook-event-repository";
import { PrismaLeadNotificationContextReader } from "@/infrastructure/database/prisma/repositories/prisma-lead-notification-context-reader";
import { PrismaLeadPurchaseRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-purchase-repository";
import { PrismaLeadRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-repository";
import { PrismaNotificationRepository } from "@/infrastructure/database/prisma/repositories/prisma-notification-repository";
import { PrismaServiceRequestRepository } from "@/infrastructure/database/prisma/repositories/prisma-service-request-repository";
import { SynchronousEventBus } from "@/infrastructure/events/synchronous-event-bus";
import { NotificationServiceCreator } from "@/infrastructure/notifications/notification-service";

import { M139_SENTINELS, assertNoContactLeak } from "../../test-utils/contact-leak-sentinels";
import { SNAPSHOT_DATA, TEST_BUYER_POLICY, fixedPriceSource, pricedOutcome } from "../../test-utils/lead-publication-fixtures";
import { setupDbTestLifecycle } from "../../test-utils/db/db-test-lifecycle";
import {
  createAddress,
  createCustomerProfile,
  createProfessionalProfile,
  createServiceCategory,
  createServiceRequest,
  createUser,
} from "../../test-utils/db/seed-helpers";

vi.mock("@/infrastructure/observability/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe("Module 145 — LEAD_V1 lead notifications (real PostgreSQL)", () => {
  setupDbTestLifecycle();

  const leads = new PrismaLeadRepository();
  const purchases = new PrismaLeadPurchaseRepository();
  const notificationRepo = new PrismaNotificationRepository();

  /** The production wiring (notification/compose.ts), on a private bus so the test owns its registrations. */
  function wire() {
    const bus = new SynchronousEventBus();
    const contexts = new PrismaLeadNotificationContextReader();
    const creator = new NotificationServiceCreator();
    bus.subscribe(LeadPublished, new NotifyLeadPublishedSubscriber(contexts, creator));
    bus.subscribe(LeadPurchaseConfirmed, new NotifyLeadPurchaseConfirmedSubscriber(contexts, creator));
    bus.subscribe(LeadPurchaseCancelled, new NotifyLeadPurchaseCancelledSubscriber(contexts, creator));
    const webhook = new ProcessLeadFeePaymentWebhookUseCase(
      purchases,
      leads,
      new ConfirmLeadPurchaseUseCase(purchases, leads, new PrismaServiceRequestRepository()),
      new TransitionLeadPurchaseUseCase(purchases),
      new PrismaExternalWebhookEventRepository(),
      bus,
    );
    return { bus, webhook };
  }

  let seq = 0;
  let evt = 0;

  async function world(flow: "LEAD_V1" | "LEGACY_QUOTE_PAYMENT" = "LEAD_V1", opts: { publish?: boolean } = {}) {
    seq += 1;
    const customerEmail = `m145-customer-${seq}@test.maestroya.invalid`;
    const customerPhone = `+3461450${String(seq).padStart(4, "0")}`;
    const customerUser = await createUser(prisma, { name: "Ana Cliente Secreta", email: customerEmail });
    await prisma.user.update({ where: { id: customerUser.id }, data: { phone: customerPhone } });
    const address = await createAddress(prisma, customerUser.id, { city: "Valencia" });
    const customer = await createCustomerProfile(prisma, customerUser.id);
    const category = await createServiceCategory(prisma);
    const request = await createServiceRequest(prisma, { customerId: customer.id, categoryId: category.id, addressId: address.id });
    await prisma.serviceRequest.update({ where: { id: request.id }, data: { flowVersion: "LEAD_V1" } });
    const draft = await leads.create({ serviceRequestId: request.id });
    const lead = opts.publish === false ? draft : (await leads.publish(draft.id, { ...SNAPSHOT_DATA, price: "100.00", maxBuyers: 5 }))!;
    if (flow !== "LEAD_V1") await prisma.serviceRequest.update({ where: { id: request.id }, data: { flowVersion: flow } });
    const proUser = await createUser(prisma, { name: "Pro Comprador" });
    const profile = await createProfessionalProfile(prisma, proUser.id);
    const purchase = opts.publish === false ? null : await purchases.initiate({ leadId: lead.id, professionalProfileId: profile.id });
    const reference = `pi_m145_${seq}`;
    if (purchase) await purchases.recordPaymentReference(purchase.id, reference);
    return { customerUser, customerEmail, customerPhone, request, lead, proUser, profile, purchase: purchase!, reference };
  }

  function stripeEvent(reference: string, type = "payment_intent.succeeded", over: Partial<NonNullable<StripePaymentWebhookEvent["paymentIntent"]>> = {}, id?: string): StripePaymentWebhookEvent {
    return {
      id: id ?? `evt_m145_${++evt}`,
      type,
      createdAt: new Date(),
      paymentIntent: { paymentIntentId: reference, lastPaymentErrorMessage: null, amountMinorUnits: 12100, currency: "eur", flow: "LEAD_V1", leadPurchaseId: null, leadId: null, ...over },
      chargeRefunded: null,
      dispute: null,
      chargeUpdated: null,
    };
  }

  const rowsFor = (userId: string) => prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
  const allRows = () => prisma.notification.findMany();

  describe("database-enforced idempotency", () => {
    it("the unique index exists on (userId, dedupeKey) and the column is nullable", async () => {
      const idx = await prisma.$queryRaw<Array<{ indexdef: string }>>`SELECT indexdef FROM pg_indexes WHERE tablename = 'notifications' AND indexname = 'notifications_userId_dedupeKey_key'`;
      expect(idx).toHaveLength(1);
      expect(idx[0]!.indexdef).toMatch(/UNIQUE INDEX .*\("userId", "dedupeKey"\)/);
      const col = await prisma.$queryRaw<Array<{ is_nullable: string; character_maximum_length: number }>>`SELECT is_nullable, character_maximum_length FROM information_schema.columns WHERE table_name = 'notifications' AND column_name = 'dedupeKey'`;
      expect(col[0]).toEqual({ is_nullable: "YES", character_maximum_length: 191 });
    });

    it("a raw duplicate (same user + key) is rejected by Postgres itself (23505), bypassing every application check", async () => {
      const user = await createUser(prisma);
      const insert = () =>
        prisma.$executeRaw`INSERT INTO notifications (id, "userId", type, title, message, "dedupeKey", "updatedAt") VALUES (gen_random_uuid(), ${user.id}::uuid, 'LEAD_PURCHASED', 't', 'm', 'k-raw', now())`;
      await insert();
      const message = await insert().then(
        () => "",
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      );
      // Prisma wraps the raw-query violation (`Raw query failed. Code: 23505. Message: Key ("userId",
      // "dedupeKey")=(...) already exists.`, or the constraint name on the driver-adapter path). Assert the
      // authoritative PostgreSQL code plus evidence of WHICH key was violated, so an unrelated failure
      // (or a successful second insert, which yields "") cannot pass.
      expect(message, message).toMatch(/23505/);
      const identifiesKey =
        message.includes("notifications_userId_dedupeKey_key") ||
        (message.includes("userId") && message.includes("dedupeKey"));
      expect(identifiesKey, message).toBe(true);
      expect(await prisma.notification.count({ where: { userId: user.id } })).toBe(1);
    });

    it("the same key for DIFFERENT users is allowed (the constraint is per recipient)", async () => {
      const [a, b] = [await createUser(prisma), await createUser(prisma)];
      const data = { type: "LEAD_PURCHASED" as const, title: "t", message: "m", resourceType: null, resourceId: null, actionUrl: null, metadata: null, dedupeKey: "shared-key" };
      expect((await notificationRepo.createIfAbsent({ ...data, userId: a.id })).created).toBe(true);
      expect((await notificationRepo.createIfAbsent({ ...data, userId: b.id })).created).toBe(true);
    });

    it("rows without a key (every pre-M145 notification) are unconstrained: the same user may have many", async () => {
      const user = await createUser(prisma);
      const base = { userId: user.id, type: "REVIEW_RECEIVED" as const, title: "t", message: "m", resourceType: null, resourceId: null, actionUrl: null, metadata: null };
      await notificationRepo.create(base);
      await notificationRepo.create(base);
      expect(await prisma.notification.count({ where: { userId: user.id, dedupeKey: null } })).toBe(2);
    });

    it("12 concurrent createIfAbsent calls produce exactly ONE row; one caller sees created:true, the rest get the same row", async () => {
      const user = await createUser(prisma);
      const data = { userId: user.id, type: "LEAD_PURCHASE_CONFIRMED" as const, title: "t", message: "m", resourceType: null, resourceId: null, actionUrl: null, metadata: null, dedupeKey: "race-key" };
      const results = await Promise.all(Array.from({ length: 12 }, () => notificationRepo.createIfAbsent(data)));
      expect(await prisma.notification.count({ where: { userId: user.id } })).toBe(1);
      expect(results.filter((r) => r.created)).toHaveLength(1);
      expect(new Set(results.map((r) => r.notification.id)).size).toBe(1);
    });

    it("a replay never overwrites the original content", async () => {
      const user = await createUser(prisma);
      const base = { userId: user.id, type: "LEAD_PURCHASED" as const, resourceType: null, resourceId: null, actionUrl: null, metadata: null, dedupeKey: "k-keep" };
      await notificationRepo.createIfAbsent({ ...base, title: "first", message: "first" });
      const again = await notificationRepo.createIfAbsent({ ...base, title: "second", message: "second" });
      expect(again.created).toBe(false);
      expect(again.notification.title).toBe("first");
    });

    it("the dedupe key is never readable through the repository's records", async () => {
      const user = await createUser(prisma);
      await notificationRepo.createIfAbsent({ userId: user.id, type: "LEAD_PURCHASED", title: "t", message: "m", resourceType: null, resourceId: null, actionUrl: null, metadata: null, dedupeKey: "secret-key" });
      const listed = await notificationRepo.listForUser(user.id, { limit: 10, offset: 0 });
      expect(JSON.stringify(listed)).not.toContain("secret-key");
      expect(JSON.stringify(listed)).not.toContain("dedupeKey");
    });

    it("legacy callers (no dedupeKey) through the production NotificationServiceCreator are unchanged: two calls, two rows, NULL key", async () => {
      const user = await createUser(prisma);
      const creator = new NotificationServiceCreator();
      const event = { userId: user.id, type: "REVIEW_RECEIVED" as const, title: "You received a new review", message: "A customer left a review for your completed job." };
      await creator.notify(event);
      await creator.notify(event);
      const rows = await rowsFor(user.id);
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.dedupeKey === null)).toBe(true);
    });
  });

  describe("M141 payment confirmation -> notifications (the authoritative path)", () => {
    it("CONFIRMED notifies the buying professional and the request's customer, once each, with their own types", async () => {
      const w = await world();
      const { webhook } = wire();
      expect((await webhook.execute(stripeEvent(w.reference))).outcome).toBe("confirmed");

      const proRows = await rowsFor(w.proUser.id);
      const customerRows = await rowsFor(w.customerUser.id);
      expect(proRows.map((r) => r.type)).toEqual(["LEAD_PURCHASE_CONFIRMED"]);
      expect(customerRows.map((r) => r.type)).toEqual(["LEAD_PURCHASED"]);
      expect(proRows[0]!.actionUrl).toBe(`/dashboard/professional/leads/${w.lead.id}/purchase`);
      expect(customerRows[0]!.actionUrl).toBe(`/requests/${w.request.id}`);
      expect(await allRows()).toHaveLength(2);
    });

    it("persists NO contact data, payment reference or internal purchase id — in any column of any notification", async () => {
      const w = await world();
      await wire().webhook.execute(stripeEvent(w.reference, "payment_intent.succeeded", { leadPurchaseId: w.purchase.id, leadId: w.lead.id }));
      const rows = await allRows();
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        const visible = { type: row.type, title: row.title, message: row.message, resourceType: row.resourceType, resourceId: row.resourceId, actionUrl: row.actionUrl, metadata: row.metadata };
        const text = JSON.stringify(visible);
        expect(() => assertNoContactLeak(visible, [w.customerEmail, w.customerPhone, "Ana Cliente Secreta", "Calle de Prueba 1", "46001", w.reference])).not.toThrow();
        expect(text).not.toContain(w.purchase.id);
        expect(text).not.toContain(w.reference);
        expect(text).not.toMatch(/pi_|stripe/i);
        for (const secret of M139_SENTINELS) expect(text).not.toContain(secret);
        expect(row.metadata).toEqual({ city: "Valencia" });
      }
      // the internal key is the only place the purchase id appears, and it is not exposed by the repository
      expect(rows.every((r) => r.dedupeKey?.includes(w.purchase.id))).toBe(true);
    });

    it("a re-delivery of the SAME Stripe event id (ledger duplicate) creates nothing new", async () => {
      const w = await world();
      const { webhook } = wire();
      await webhook.execute(stripeEvent(w.reference, "payment_intent.succeeded", {}, "evt_same_delivery"));
      const again = await webhook.execute(stripeEvent(w.reference, "payment_intent.succeeded", {}, "evt_same_delivery"));
      expect(again.outcome).toBe("duplicate");
      expect(await allRows()).toHaveLength(2);
    });

    it("a NEW event id observing the already-confirmed purchase re-attempts the notification, which the database dedupes", async () => {
      const w = await world();
      const { webhook } = wire();
      await webhook.execute(stripeEvent(w.reference));
      const again = await webhook.execute(stripeEvent(w.reference));
      expect(again.outcome).toBe("already-confirmed");
      expect(await allRows()).toHaveLength(2);
    });

    it("heals a lost notification: if the first attempt failed, the next delivery creates it — exactly once", async () => {
      const w = await world();
      // first delivery with a bus whose subscribers are absent => purchase confirmed, nothing notified
      const silent = new ProcessLeadFeePaymentWebhookUseCase(
        purchases,
        leads,
        new ConfirmLeadPurchaseUseCase(purchases, leads, new PrismaServiceRequestRepository()),
        new TransitionLeadPurchaseUseCase(purchases),
        new PrismaExternalWebhookEventRepository(),
      );
      expect((await silent.execute(stripeEvent(w.reference))).outcome).toBe("confirmed");
      expect(await allRows()).toHaveLength(0);

      const { webhook } = wire();
      expect((await webhook.execute(stripeEvent(w.reference))).outcome).toBe("already-confirmed");
      expect(await allRows()).toHaveLength(2);
      await webhook.execute(stripeEvent(w.reference));
      expect(await allRows()).toHaveLength(2);
    });

    it("6 concurrent deliveries (distinct event ids) leave exactly one notification per recipient", async () => {
      const w = await world();
      const { webhook } = wire();
      const results = await Promise.all(Array.from({ length: 6 }, () => webhook.execute(stripeEvent(w.reference))));
      expect(results.every((r) => r.outcome === "confirmed" || r.outcome === "already-confirmed")).toBe(true);
      expect(await rowsFor(w.proUser.id)).toHaveLength(1);
      expect(await rowsFor(w.customerUser.id)).toHaveLength(1);
      expect(await allRows()).toHaveLength(2);
    });

    it("payment_failed produces NO notification and leaves the purchase PENDING_PAYMENT", async () => {
      const w = await world();
      const result = await wire().webhook.execute(stripeEvent(w.reference, "payment_intent.payment_failed"));
      expect(result.outcome).toBe("payment-failed-observed");
      expect(await allRows()).toHaveLength(0);
      expect((await prisma.leadPurchase.findUniqueOrThrow({ where: { id: w.purchase.id } })).status).toBe("PENDING_PAYMENT");
    });

    it("a rejected success (wrong amount) produces NO notification and does not confirm", async () => {
      const w = await world();
      const result = await wire().webhook.execute(stripeEvent(w.reference, "payment_intent.succeeded", { amountMinorUnits: 5 }));
      expect(result.outcome).toBe("rejected");
      expect(await allRows()).toHaveLength(0);
      expect((await prisma.leadPurchase.findUniqueOrThrow({ where: { id: w.purchase.id } })).status).toBe("PENDING_PAYMENT");
    });

    it("payment_intent.canceled notifies ONLY the professional (non-success type), once, even when repeated", async () => {
      const w = await world();
      const { webhook } = wire();
      expect((await webhook.execute(stripeEvent(w.reference, "payment_intent.canceled"))).outcome).toBe("cancelled");
      await webhook.execute(stripeEvent(w.reference, "payment_intent.canceled"));
      expect((await rowsFor(w.proUser.id)).map((r) => r.type)).toEqual(["LEAD_PURCHASE_CANCELLED"]);
      expect(await rowsFor(w.customerUser.id)).toHaveLength(0);
      expect((await allRows()).some((r) => r.type === "LEAD_PURCHASE_CONFIRMED" || r.type === "LEAD_PURCHASED")).toBe(false);
    });

    it("a success arriving after the purchase was CANCELLED is rejected: no success notification", async () => {
      const w = await world();
      const { webhook } = wire();
      await webhook.execute(stripeEvent(w.reference, "payment_intent.canceled"));
      const late = await webhook.execute(stripeEvent(w.reference, "payment_intent.succeeded"));
      expect(late.outcome).toBe("rejected");
      expect((await allRows()).map((r) => r.type)).toEqual(["LEAD_PURCHASE_CANCELLED"]);
    });

    it("recipient isolation: Purchase A confirming notifies only A's customer and A's professional — B's users get nothing", async () => {
      const a = await world();
      const b = await world();
      const { webhook } = wire();
      await webhook.execute(stripeEvent(a.reference));
      expect(await rowsFor(b.customerUser.id)).toHaveLength(0);
      expect(await rowsFor(b.proUser.id)).toHaveLength(0);
      expect((await rowsFor(a.proUser.id)).map((r) => r.type)).toEqual(["LEAD_PURCHASE_CONFIRMED"]);
      expect((await rowsFor(a.customerUser.id)).map((r) => r.type)).toEqual(["LEAD_PURCHASED"]);

      await webhook.execute(stripeEvent(b.reference));
      expect((await rowsFor(b.proUser.id)).map((r) => r.type)).toEqual(["LEAD_PURCHASE_CONFIRMED"]);
      expect(await rowsFor(a.proUser.id)).toHaveLength(1);
      expect(await rowsFor(a.customerUser.id)).toHaveLength(1);
    });
  });

  describe("subscribers re-verify persisted state (defense in depth)", () => {
    it("a LeadPurchaseConfirmed published for a PENDING_PAYMENT purchase notifies nobody", async () => {
      const w = await world();
      await wire().bus.publish(new LeadPurchaseConfirmed(w.purchase.id));
      expect(await allRows()).toHaveLength(0);
    });

    it("a LeadPurchaseConfirmed published for a CANCELLED or FAILED purchase notifies nobody", async () => {
      const cancelled = await world();
      const failed = await world();
      await new TransitionLeadPurchaseUseCase(purchases).execute(cancelled.purchase.id, "CANCELLED");
      await new TransitionLeadPurchaseUseCase(purchases).execute(failed.purchase.id, "FAILED");
      const { bus } = wire();
      await bus.publish(new LeadPurchaseConfirmed(cancelled.purchase.id));
      await bus.publish(new LeadPurchaseConfirmed(failed.purchase.id));
      expect(await allRows()).toHaveLength(0);
    });

    it("a LeadPurchaseCancelled published for a CONFIRMED purchase notifies nobody", async () => {
      const w = await world();
      await new ConfirmLeadPurchaseUseCase(purchases, leads, new PrismaServiceRequestRepository()).execute(w.purchase.id);
      await wire().bus.publish(new LeadPurchaseCancelled(w.purchase.id));
      expect(await allRows()).toHaveLength(0);
    });

    it("an unknown id notifies nobody and does not throw", async () => {
      const { bus } = wire();
      await expect(bus.publish(new LeadPurchaseConfirmed("00000000-0000-4000-8000-000000000000"))).resolves.toBeUndefined();
      await expect(bus.publish(new LeadPublished("00000000-0000-4000-8000-000000000000"))).resolves.toBeUndefined();
      expect(await allRows()).toHaveLength(0);
    });
  });

  describe("legacy isolation", () => {
    it("a lead-fee webhook for a non-LEAD_V1 request is rejected by M141 and notifies nobody", async () => {
      const w = await world("LEGACY_QUOTE_PAYMENT");
      const result = await wire().webhook.execute(stripeEvent(w.reference));
      expect(result).toMatchObject({ outcome: "rejected", rejection: "NOT_LEAD_V1" });
      expect(await allRows()).toHaveLength(0);
    });

    it("even a hand-published LeadPurchaseConfirmed / LeadPublished for a legacy-flow request notifies nobody (the reader yields no context)", async () => {
      const w = await world("LEGACY_QUOTE_PAYMENT");
      await prisma.leadPurchase.update({ where: { id: w.purchase.id }, data: { status: "CONFIRMED" } });
      const { bus } = wire();
      await bus.publish(new LeadPurchaseConfirmed(w.purchase.id));
      await bus.publish(new LeadPublished(w.lead.id));
      expect(await allRows()).toHaveLength(0);
      expect(await new PrismaLeadNotificationContextReader().findForPurchase(w.purchase.id)).toBeNull();
      expect(await new PrismaLeadNotificationContextReader().findForLead(w.lead.id)).toBeNull();
    });
  });

  describe("publication (M133) -> customer notification", () => {
    it("LeadPublished notifies the request's customer exactly once, however often it is replayed", async () => {
      const w = await world("LEAD_V1");
      const { bus } = wire();
      await Promise.all([bus.publish(new LeadPublished(w.lead.id)), bus.publish(new LeadPublished(w.lead.id)), bus.publish(new LeadPublished(w.lead.id))]);
      await bus.publish(new LeadPublished(w.lead.id));
      const rows = await allRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ userId: w.customerUser.id, type: "LEAD_REQUEST_PUBLISHED", actionUrl: `/requests/${w.request.id}` });
      expect(await rowsFor(w.proUser.id)).toHaveLength(0);
    });

    it("a DRAFT lead notifies nobody", async () => {
      const w = await world("LEAD_V1", { publish: false });
      await wire().bus.publish(new LeadPublished(w.lead.id));
      expect(await allRows()).toHaveLength(0);
    });

    it("end to end with the real PublishLeadUseCase: publishing creates the notification; republishing adds none", async () => {
      const w = await world("LEAD_V1", { publish: false });
      const { bus } = wire();
      const publish = new PublishLeadUseCase(
        new PrismaCustomerProfileRepository(),
        new PrismaServiceRequestRepository(),
        leads,
        fixedPriceSource(pricedOutcome()),
        TEST_BUYER_POLICY,
        bus,
      );
      const first = await publish.execute(w.customerUser.id, w.lead.id);
      expect(first.status).toBe("PUBLISHED");
      expect((await allRows()).map((r) => [r.userId, r.type])).toEqual([[w.customerUser.id, "LEAD_REQUEST_PUBLISHED"]]);

      await publish.execute(w.customerUser.id, w.lead.id);
      await Promise.all(Array.from({ length: 4 }, () => publish.execute(w.customerUser.id, w.lead.id)));
      expect(await allRows()).toHaveLength(1);
    });
  });
});
