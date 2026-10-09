import { describe, expect, it, vi } from "vitest";

import { LeadPublished } from "@/domain/events/lead-published";
import { LeadPurchaseCancelled } from "@/domain/events/lead-purchase-cancelled";
import { LeadPurchaseConfirmed } from "@/domain/events/lead-purchase-confirmed";
import type {
  LeadNotificationContext,
  LeadNotificationContextReader,
  LeadPurchaseNotificationContext,
} from "@/domain/repositories/lead-notification-context-reader";
import type { LeadPurchaseStatus } from "@/domain/services/lead-purchase";
import type { NotificationCreator, NotificationEvent } from "@/application/ports/notification-creator";
import { NotifyLeadPublishedSubscriber } from "@/application/use-cases/notification/notify-lead-published.subscriber";
import { NotifyLeadPurchaseCancelledSubscriber } from "@/application/use-cases/notification/notify-lead-purchase-cancelled.subscriber";
import { NotifyLeadPurchaseConfirmedSubscriber } from "@/application/use-cases/notification/notify-lead-purchase-confirmed.subscriber";

import { M139_SENTINELS } from "../../../../../test-utils/contact-leak-sentinels";

/** Module 145 — LEAD_V1 notification subscribers: recipients, lifecycle gating, privacy, legacy isolation. */

const LEAD_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LEAD_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const REQ_A = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const REQ_B = "b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1";
const PURCHASE_A = "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2";
const PURCHASE_B = "b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2";
const CUSTOMER_A = "user-customer-A";
const CUSTOMER_B = "user-customer-B";
const PRO_A = "user-pro-A";
const PRO_B = "user-pro-B";
const PAYMENT_REFERENCE = "pi_secret_reference_123";

const leadCtx = (over: Partial<LeadNotificationContext & { leadStatus: string }> = {}) => ({
  leadId: LEAD_A,
  serviceRequestId: REQ_A,
  customerUserId: CUSTOMER_A,
  city: "Madrid",
  leadStatus: "PUBLISHED",
  ...over,
});

const purchaseCtx = (status: LeadPurchaseStatus, over: Partial<LeadPurchaseNotificationContext> = {}): LeadPurchaseNotificationContext => ({
  leadId: LEAD_A,
  serviceRequestId: REQ_A,
  customerUserId: CUSTOMER_A,
  professionalUserId: PRO_A,
  city: "Madrid",
  purchaseStatus: status,
  ...over,
});

function harness(opts: { leads?: Record<string, ReturnType<typeof leadCtx> | null>; purchases?: Record<string, LeadPurchaseNotificationContext | null> } = {}) {
  const sent: NotificationEvent[] = [];
  const notifications: NotificationCreator = {
    notify: vi.fn(async (event: NotificationEvent) => {
      sent.push(event);
    }),
  };
  const reader: LeadNotificationContextReader = {
    findForLead: vi.fn(async (id: string) => opts.leads?.[id] ?? null),
    findForPurchase: vi.fn(async (id: string) => opts.purchases?.[id] ?? null),
  };
  return { sent, notifications, reader };
}

/** What a human can ever see or follow: everything except the internal dedupe key. */
const visible = (event: NotificationEvent) =>
  JSON.stringify({
    type: event.type,
    title: event.title,
    message: event.message,
    resourceType: event.resourceType,
    resourceId: event.resourceId,
    actionUrl: event.actionUrl,
    metadata: event.metadata,
  });

describe("NotifyLeadPublishedSubscriber", () => {
  it("notifies ONLY the request's customer, with the persisted owner (not the event) as recipient", async () => {
    const h = harness({ leads: { [LEAD_A]: leadCtx() } });
    await new NotifyLeadPublishedSubscriber(h.reader, h.notifications).handle(new LeadPublished(LEAD_A));

    expect(h.sent).toHaveLength(1);
    const [event] = h.sent;
    expect(event).toMatchObject({
      userId: CUSTOMER_A,
      type: "LEAD_REQUEST_PUBLISHED",
      category: "SUCCESS",
      actionUrl: `/requests/${REQ_A}`,
      metadata: { city: "Madrid" },
      dedupeKey: `lead-v1:lead-published:${LEAD_A}:customer`,
      channels: ["IN_APP", "REALTIME"],
    });
    expect(event?.channels).not.toContain("EMAIL");
  });

  it("recipient isolation: Customer A's publication never reaches Customer B", async () => {
    const h = harness({ leads: { [LEAD_A]: leadCtx(), [LEAD_B]: leadCtx({ leadId: LEAD_B, serviceRequestId: REQ_B, customerUserId: CUSTOMER_B, city: "Sevilla" }) } });
    const sub = new NotifyLeadPublishedSubscriber(h.reader, h.notifications);
    await sub.handle(new LeadPublished(LEAD_A));
    expect(h.sent.map((e) => e.userId)).toEqual([CUSTOMER_A]);
    expect(h.sent.map((e) => e.userId)).not.toContain(CUSTOMER_B);
    await sub.handle(new LeadPublished(LEAD_B));
    expect(h.sent.map((e) => e.userId)).toEqual([CUSTOMER_A, CUSTOMER_B]);
    expect(h.sent[1]?.actionUrl).toBe(`/requests/${REQ_B}`);
  });

  it.each(["DRAFT", "CLOSED", "EXPIRED", "CANCELLED"])("does not notify when the lead is %s", async (leadStatus) => {
    const h = harness({ leads: { [LEAD_A]: leadCtx({ leadStatus }) } });
    await new NotifyLeadPublishedSubscriber(h.reader, h.notifications).handle(new LeadPublished(LEAD_A));
    expect(h.sent).toEqual([]);
  });

  it("does not notify for an unknown or non-LEAD_V1 lead (the reader returns null)", async () => {
    const h = harness({ leads: { [LEAD_A]: null } });
    await new NotifyLeadPublishedSubscriber(h.reader, h.notifications).handle(new LeadPublished(LEAD_A));
    expect(h.sent).toEqual([]);
  });

  it("the customer's visible content has no purchase/payment value, no lead id and no contact data", async () => {
    const h = harness({ leads: { [LEAD_A]: leadCtx() } });
    await new NotifyLeadPublishedSubscriber(h.reader, h.notifications).handle(new LeadPublished(LEAD_A));
    const text = visible(h.sent[0]!);
    expect(text).not.toContain(LEAD_A);
    for (const secret of M139_SENTINELS) expect(text).not.toContain(secret);
  });
});

describe("NotifyLeadPurchaseConfirmedSubscriber", () => {
  const confirmed = (over: Partial<LeadPurchaseNotificationContext> = {}) => ({ [PURCHASE_A]: purchaseCtx("CONFIRMED", over) });

  it("CONFIRMED notifies the buying professional AND the request's customer, each once, with their own types", async () => {
    const h = harness({ purchases: confirmed() });
    await new NotifyLeadPurchaseConfirmedSubscriber(h.reader, h.notifications).handle(new LeadPurchaseConfirmed(PURCHASE_A));

    expect(h.sent).toHaveLength(2);
    const pro = h.sent.find((e) => e.userId === PRO_A);
    const customer = h.sent.find((e) => e.userId === CUSTOMER_A);
    expect(pro).toMatchObject({
      type: "LEAD_PURCHASE_CONFIRMED",
      category: "SUCCESS",
      actionUrl: `/dashboard/professional/leads/${LEAD_A}/purchase`,
      dedupeKey: `lead-v1:purchase-confirmed:${PURCHASE_A}:professional`,
    });
    expect(customer).toMatchObject({
      type: "LEAD_PURCHASED",
      actionUrl: `/requests/${REQ_A}`,
      dedupeKey: `lead-v1:purchase-confirmed:${PURCHASE_A}:customer`,
    });
  });

  it.each<LeadPurchaseStatus>(["PENDING_PAYMENT", "FAILED", "CANCELLED", "REFUNDED", "REVOKED"])(
    "a %s purchase produces NO success notification for anybody",
    async (status) => {
      const h = harness({ purchases: { [PURCHASE_A]: purchaseCtx(status) } });
      await new NotifyLeadPurchaseConfirmedSubscriber(h.reader, h.notifications).handle(new LeadPurchaseConfirmed(PURCHASE_A));
      expect(h.sent).toEqual([]);
    },
  );

  it("recipient isolation: Professional A's purchase never notifies Professional B or Customer B", async () => {
    const h = harness({
      purchases: {
        [PURCHASE_A]: purchaseCtx("CONFIRMED"),
        [PURCHASE_B]: purchaseCtx("CONFIRMED", { leadId: LEAD_B, serviceRequestId: REQ_B, customerUserId: CUSTOMER_B, professionalUserId: PRO_B }),
      },
    });
    await new NotifyLeadPurchaseConfirmedSubscriber(h.reader, h.notifications).handle(new LeadPurchaseConfirmed(PURCHASE_A));
    const recipients = h.sent.map((e) => e.userId).sort();
    expect(recipients).toEqual([CUSTOMER_A, PRO_A].sort());
    expect(recipients).not.toContain(PRO_B);
    expect(recipients).not.toContain(CUSTOMER_B);
  });

  it("legacy / unknown purchase (reader returns null) notifies nobody", async () => {
    const h = harness({ purchases: { [PURCHASE_A]: null } });
    await new NotifyLeadPurchaseConfirmedSubscriber(h.reader, h.notifications).handle(new LeadPurchaseConfirmed(PURCHASE_A));
    expect(h.sent).toEqual([]);
    expect(h.reader.findForLead).not.toHaveBeenCalled();
  });

  it("never puts contact data, a payment reference or an internal id in anything a user can see", async () => {
    const h = harness({ purchases: confirmed() });
    await new NotifyLeadPurchaseConfirmedSubscriber(h.reader, h.notifications).handle(new LeadPurchaseConfirmed(PURCHASE_A));
    for (const event of h.sent) {
      const text = visible(event);
      expect(text).not.toContain(PURCHASE_A);
      expect(text).not.toContain(PAYMENT_REFERENCE);
      expect(text).not.toMatch(/pi_|payment_intent|stripe/i);
      expect(text).not.toMatch(/@|\+\d{6,}/); // no email address / phone number
      for (const secret of M139_SENTINELS) expect(text).not.toContain(secret);
      expect(Object.keys(event.metadata ?? {})).toEqual(["city"]);
      expect(event.resourceType ?? null).toBeNull();
      expect(event.resourceId ?? null).toBeNull();
    }
    // the customer never receives the lead id (they do not use it); the professional never receives the request id
    expect(visible(h.sent.find((e) => e.userId === CUSTOMER_A)!)).not.toContain(LEAD_A);
    expect(visible(h.sent.find((e) => e.userId === PRO_A)!)).not.toContain(REQ_A);
  });

  it("one recipient failing does not suppress the other, and the failure is still surfaced", async () => {
    const h = harness({ purchases: confirmed() });
    (h.notifications.notify as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      throw new Error("in-app down");
    });
    await expect(new NotifyLeadPurchaseConfirmedSubscriber(h.reader, h.notifications).handle(new LeadPurchaseConfirmed(PURCHASE_A))).rejects.toThrow("in-app down");
    expect(h.sent.map((e) => e.userId)).toEqual([CUSTOMER_A]);
  });
});

describe("NotifyLeadPurchaseCancelledSubscriber", () => {
  it("CANCELLED notifies ONLY the buying professional, with a non-success type", async () => {
    const h = harness({ purchases: { [PURCHASE_A]: purchaseCtx("CANCELLED") } });
    await new NotifyLeadPurchaseCancelledSubscriber(h.reader, h.notifications).handle(new LeadPurchaseCancelled(PURCHASE_A));
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toMatchObject({ userId: PRO_A, type: "LEAD_PURCHASE_CANCELLED", category: "WARNING", dedupeKey: `lead-v1:purchase-cancelled:${PURCHASE_A}:professional` });
    expect(h.sent.map((e) => e.userId)).not.toContain(CUSTOMER_A);
    expect(visible(h.sent[0]!)).not.toContain(PURCHASE_A);
  });

  it.each<LeadPurchaseStatus>(["PENDING_PAYMENT", "CONFIRMED", "FAILED", "REFUNDED", "REVOKED"])(
    "a %s purchase produces no cancellation notification (e.g. a stale or mis-published event)",
    async (status) => {
      const h = harness({ purchases: { [PURCHASE_A]: purchaseCtx(status) } });
      await new NotifyLeadPurchaseCancelledSubscriber(h.reader, h.notifications).handle(new LeadPurchaseCancelled(PURCHASE_A));
      expect(h.sent).toEqual([]);
    },
  );

  it("legacy / unknown purchase notifies nobody", async () => {
    const h = harness({ purchases: { [PURCHASE_A]: null } });
    await new NotifyLeadPurchaseCancelledSubscriber(h.reader, h.notifications).handle(new LeadPurchaseCancelled(PURCHASE_A));
    expect(h.sent).toEqual([]);
  });
});
