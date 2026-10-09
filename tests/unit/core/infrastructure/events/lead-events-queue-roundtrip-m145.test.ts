import { describe, expect, it } from "vitest";

import { LeadPublished } from "@/domain/events/lead-published";
import { LeadPurchaseCancelled } from "@/domain/events/lead-purchase-cancelled";
import { LeadPurchaseConfirmed } from "@/domain/events/lead-purchase-confirmed";
import { deserializeEventJob, serializeEventJob } from "@/infrastructure/events/event-job-serializer";

/**
 * Module 145 — when EVENT_QUEUE_ENABLED=true the bus serializes events onto a job queue. The three
 * LEAD_V1 events carry only strings, so they must survive that trip unchanged and still be the real
 * event classes (the subscribers re-read all state from the database either way).
 */
describe("M145 events over the queued bus", () => {
  it.each([
    [LeadPublished, new LeadPublished("lead-1"), { leadId: "lead-1" }],
    [LeadPurchaseConfirmed, new LeadPurchaseConfirmed("purchase-1"), { purchaseId: "purchase-1" }],
    [LeadPurchaseCancelled, new LeadPurchaseCancelled("purchase-2"), { purchaseId: "purchase-2" }],
  ] as const)("%o round-trips as a genuine instance with its id payload", (eventClass, event, payload) => {
    const job = serializeEventJob(event, `${eventClass.eventName}#0:Handler`);
    expect(job.payload).toEqual(payload);
    const revived = deserializeEventJob(JSON.parse(JSON.stringify(job)), eventClass);
    expect(revived).toBeInstanceOf(eventClass);
    expect(revived.eventName).toBe(eventClass.eventName);
    expect(revived.eventId).toBe(event.eventId);
    expect(revived).toMatchObject(payload);
  });

  it("uses distinct stable event names", () => {
    expect(new Set([LeadPublished.eventName, LeadPurchaseConfirmed.eventName, LeadPurchaseCancelled.eventName]).size).toBe(3);
  });
});
