/**
 * Module 91 — Real-Database Integration Test Harness.
 *
 * Invariant E — Stripe/webhook idempotency: proves
 * `ExternalWebhookEvent(provider, externalEventId)`'s unique index
 * prevents duplicate event rows, and exercises the actual atomic
 * `PrismaExternalWebhookEventRepository.claim()` method (the
 * `createIfNotExists`-equivalent this repository exposes — see that
 * class's own doc comment) under genuine concurrency, since `claim()` is
 * exactly the method every inbound webhook route depends on for "the
 * same delivery redelivered twice must never double-process."
 */
import { describe, expect, it } from "vitest";

import { prisma } from "@/infrastructure/database/prisma/client";
import { PrismaExternalWebhookEventRepository } from "@/infrastructure/database/prisma/repositories/prisma-external-webhook-event-repository";

import { setupDbTestLifecycle } from "../../test-utils/db/db-test-lifecycle";

describe("Module 91 — ExternalWebhookEvent(provider, externalEventId) uniqueness (real PostgreSQL)", () => {
  setupDbTestLifecycle();

  it("claim() on a fresh event claims it; a second claim() for the same (provider, externalEventId) is refused while PROCESSING", async () => {
    const repository = new PrismaExternalWebhookEventRepository();
    const input = { provider: "STRIPE", externalEventId: "evt_module91_basic" };

    const first = await repository.claim(input);
    expect(first.claimed).toBe(true);
    expect(first.record.status).toBe("PROCESSING");

    const second = await repository.claim(input);
    expect(second.claimed).toBe(false);
    expect(second.record.id).toBe(first.record.id);

    const rows = await prisma.$queryRawUnsafe<{ count: string }[]>(
      `SELECT count(*)::text as count FROM "external_webhook_events" WHERE "provider" = $1 AND "externalEventId" = $2`,
      input.provider,
      input.externalEventId,
    );
    expect(rows[0]?.count).toBe("1");
  });

  it("REAL CONCURRENT claim() calls for the same event (Promise.all) let exactly one caller proceed", async () => {
    const repository = new PrismaExternalWebhookEventRepository();
    const input = { provider: "STRIPE", externalEventId: "evt_module91_concurrent" };

    const results = await Promise.all(Array.from({ length: 10 }, () => repository.claim(input)));

    const claimedCount = results.filter((r) => r.claimed).length;
    expect(claimedCount).toBe(1);

    const rows = await prisma.$queryRawUnsafe<{ count: string }[]>(
      `SELECT count(*)::text as count FROM "external_webhook_events" WHERE "provider" = $1 AND "externalEventId" = $2`,
      input.provider,
      input.externalEventId,
    );
    expect(rows[0]?.count).toBe("1");
  });

  it("a FAILED event may be reclaimed by a retry, but a PROCESSED event never can", async () => {
    const repository = new PrismaExternalWebhookEventRepository();

    const failedEvent = { provider: "STRIPE", externalEventId: "evt_module91_failed_retry" };
    const claimed = await repository.claim(failedEvent);
    await repository.markFailed(claimed.record.id);

    const reclaim = await repository.claim(failedEvent);
    expect(reclaim.claimed).toBe(true);
    expect(reclaim.record.id).toBe(claimed.record.id);

    const processedEvent = { provider: "STRIPE", externalEventId: "evt_module91_processed_no_retry" };
    const claimedProcessed = await repository.claim(processedEvent);
    await repository.markProcessed(claimedProcessed.record.id);

    const secondDelivery = await repository.claim(processedEvent);
    expect(secondDelivery.claimed).toBe(false);
    expect(secondDelivery.record.status).toBe("PROCESSED");
  });

  it("the SAME externalEventId under a DIFFERENT provider is a distinct event (uniqueness is the pair, not either column alone)", async () => {
    const repository = new PrismaExternalWebhookEventRepository();
    const externalEventId = "evt_module91_shared_id";

    const stripeClaim = await repository.claim({ provider: "STRIPE", externalEventId });
    const personaClaim = await repository.claim({ provider: "PERSONA", externalEventId });

    expect(stripeClaim.claimed).toBe(true);
    expect(personaClaim.claimed).toBe(true);
    expect(stripeClaim.record.id).not.toBe(personaClaim.record.id);
  });
});
