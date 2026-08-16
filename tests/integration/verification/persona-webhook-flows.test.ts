import { beforeEach, describe, expect, it } from "vitest";

import { ProcessPersonaWebhookUseCase } from "@/application/use-cases/verification/process-persona-webhook.use-case";
import { RefreshVerificationStatusUseCase } from "@/application/use-cases/verification/refresh-verification-status.use-case";
import { StartProfessionalVerificationUseCase } from "@/application/use-cases/verification/start-professional-verification.use-case";
import type {
  ClaimExternalWebhookEventInput,
  ClaimExternalWebhookEventResult,
  ExternalWebhookEventRecord,
  ExternalWebhookEventRepository,
} from "@/domain/repositories/external-webhook-event-repository";
import { SynchronousEventBus } from "@/infrastructure/events/synchronous-event-bus";
import {
  FakeAdminAuditLogRepository,
  FakeNotificationCreator,
  FakeProfessionalRepository,
  FakeProfessionalVerificationRepository,
  FakeVerificationProvider,
} from "./fakes";

/**
 * Module 70.1 — Pre-Stripe Security & Integration Hardening (Objectives B
 * & C): integration tests for `ProcessPersonaWebhookUseCase` — the
 * application-layer piece `/api/webhooks/persona/route.ts` delegates to
 * once `PersonaVerificationProvider.webhookValidation` has already
 * verified a request's signature (see that route's own doc comment; HTTP
 * wiring itself is covered separately by
 * tests/unit/app/api/webhooks-persona-route.test.ts). Real use case +
 * fake repositories/provider, reusing Module 59's own fakes — same
 * pattern as provider-verification-flows.test.ts.
 */

/**
 * In-memory `ExternalWebhookEventRepository` implementing the exact same
 * claim/retry state machine as
 * `PrismaExternalWebhookEventRepository` — see that class's and the
 * domain interface's own doc comments for the full design this fake
 * mirrors (claim-by-insert, `(provider, externalEventId)` uniqueness, a
 * `FAILED` event is the only one a later delivery may reclaim).
 */
class FakeExternalWebhookEventRepository implements ExternalWebhookEventRepository {
  events = new Map<string, ExternalWebhookEventRecord>();
  private idCounter = 0;

  private findExisting(provider: string, externalEventId: string): ExternalWebhookEventRecord | undefined {
    return [...this.events.values()].find((e) => e.provider === provider && e.externalEventId === externalEventId);
  }

  async claim(input: ClaimExternalWebhookEventInput): Promise<ClaimExternalWebhookEventResult> {
    const existing = this.findExisting(input.provider, input.externalEventId);
    if (!existing) {
      const record: ExternalWebhookEventRecord = {
        id: `event-${++this.idCounter}`,
        provider: input.provider,
        externalEventId: input.externalEventId,
        eventType: input.eventType ?? null,
        status: "PROCESSING",
        processedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.events.set(record.id, record);
      return { claimed: true, record };
    }

    if (existing.status === "FAILED") {
      const reclaimed: ExternalWebhookEventRecord = {
        ...existing,
        status: "PROCESSING",
        eventType: input.eventType ?? existing.eventType,
        updatedAt: new Date(),
      };
      this.events.set(existing.id, reclaimed);
      return { claimed: true, record: reclaimed };
    }

    return { claimed: false, record: existing };
  }

  async markProcessed(id: string): Promise<ExternalWebhookEventRecord> {
    const existing = this.events.get(id);
    if (!existing) throw new Error(`No fake external webhook event with id "${id}".`);
    const updated: ExternalWebhookEventRecord = { ...existing, status: "PROCESSED", processedAt: new Date(), updatedAt: new Date() };
    this.events.set(id, updated);
    return updated;
  }

  async markFailed(id: string): Promise<ExternalWebhookEventRecord> {
    const existing = this.events.get(id);
    if (!existing) throw new Error(`No fake external webhook event with id "${id}".`);
    const updated: ExternalWebhookEventRecord = { ...existing, status: "FAILED", updatedAt: new Date() };
    this.events.set(id, updated);
    return updated;
  }
}

function makeContext() {
  const professionals = new FakeProfessionalRepository();
  const verifications = new FakeProfessionalVerificationRepository(professionals);
  const auditLog = new FakeAdminAuditLogRepository();
  const notifications = new FakeNotificationCreator();
  const provider = new FakeVerificationProvider();
  const eventBus = new SynchronousEventBus();
  const webhookEvents = new FakeExternalWebhookEventRepository();

  const refresh = new RefreshVerificationStatusUseCase(verifications, professionals, provider, auditLog, notifications);
  const start = new StartProfessionalVerificationUseCase(verifications, professionals, provider, eventBus);
  const processWebhook = new ProcessPersonaWebhookUseCase(verifications, webhookEvents, refresh);

  return { professionals, verifications, auditLog, notifications, provider, webhookEvents, refresh, start, processWebhook };
}

async function seedActiveCase(ctx: ReturnType<typeof makeContext>) {
  ctx.professionals.seed({ userId: "user-1", status: "ACTIVE" });
  const { verification } = await ctx.start.execute({ userId: "user-1", fullName: "Ana García", countryCode: "ES" });
  return verification;
}

describe("Module 70.1 — ProcessPersonaWebhookUseCase", () => {
  let ctx: ReturnType<typeof makeContext>;
  beforeEach(() => {
    ctx = makeContext();
  });

  it("VERIFIED: resolves the inquiry id to the internal case (never trusting a client-supplied id) and applies an APPROVED transition via a fresh provider read, not the webhook body", async () => {
    const verification = await seedActiveCase(ctx);

    ctx.provider.nextOutcome = "VERIFIED";
    ctx.provider.nextRawStatus = "completed";

    const result = await ctx.processWebhook.execute({
      externalEventId: "evt-1",
      eventType: "inquiry.completed",
      providerVerificationId: verification.providerVerificationId,
    });

    expect(result.outcome).toBe("processed");
    expect(result.verificationId).toBe(verification.id);
    const updated = await ctx.verifications.findById(verification.id);
    expect(updated?.status).toBe("APPROVED");
    // The re-fetch really happened — this is what makes the webhook body's
    // own embedded status irrelevant to the actual state transition.
    expect(ctx.provider.refreshCalls).toContain(verification.providerVerificationId);
  });

  it("REJECTED: applies a REJECTED transition the same way", async () => {
    const verification = await seedActiveCase(ctx);
    ctx.provider.nextOutcome = "REJECTED";
    ctx.provider.nextRawStatus = "failed";
    ctx.provider.nextFailureReason = "Blurry document photo.";

    const result = await ctx.processWebhook.execute({
      externalEventId: "evt-2",
      eventType: "inquiry.failed",
      providerVerificationId: verification.providerVerificationId,
    });

    expect(result.outcome).toBe("processed");
    const updated = await ctx.verifications.findById(verification.id);
    expect(updated?.status).toBe("REJECTED");
    expect(updated?.rejectionReason).toBe("Blurry document photo.");
  });

  it("NEEDS_REVIEW / IN_PROGRESS: never marks a professional verified for anything short of a real VERIFIED outcome", async () => {
    const verification = await seedActiveCase(ctx);
    ctx.provider.nextOutcome = "NEEDS_REVIEW";
    ctx.provider.nextRawStatus = "needs_review";

    const result = await ctx.processWebhook.execute({
      externalEventId: "evt-3",
      eventType: "inquiry.marked-for-review",
      providerVerificationId: verification.providerVerificationId,
    });

    expect(result.outcome).toBe("processed");
    const updated = await ctx.verifications.findById(verification.id);
    expect(updated?.status).toBe("UNDER_REVIEW");
    const professional = await ctx.professionals.findByUserId("user-1");
    expect(professional?.verificationStatus).not.toBe("VERIFIED");
  });

  it("unknown/unrecognized provider outcome fails safe — no status transition, never silently verified", async () => {
    const verification = await seedActiveCase(ctx);
    // FakeVerificationProvider's nextOutcome can be set to any
    // ProviderVerificationOutcome; "IN_PROGRESS" is the safe default
    // `resolveProviderStatusTransition` maps every unrecognized/future
    // Persona status onto (see verification-provider-outcome.ts).
    ctx.provider.nextOutcome = "IN_PROGRESS";
    ctx.provider.nextRawStatus = "some-future-persona-status";

    const result = await ctx.processWebhook.execute({
      externalEventId: "evt-4",
      eventType: "inquiry.unknown",
      providerVerificationId: verification.providerVerificationId,
    });

    expect(result.outcome).toBe("processed");
    const updated = await ctx.verifications.findById(verification.id);
    expect(updated?.status).toBe(verification.status); // unchanged
    const professional = await ctx.professionals.findByUserId("user-1");
    expect(professional?.verificationStatus).not.toBe("VERIFIED");
  });

  it("duplicate delivery of the same event id never re-processes (idempotency)", async () => {
    const verification = await seedActiveCase(ctx);
    ctx.provider.nextOutcome = "VERIFIED";

    const first = await ctx.processWebhook.execute({
      externalEventId: "evt-dup",
      eventType: "inquiry.completed",
      providerVerificationId: verification.providerVerificationId,
    });
    expect(first.outcome).toBe("processed");
    const refreshCallsAfterFirst = ctx.provider.refreshCalls.length;

    // A second, genuinely duplicate delivery of the exact same event.
    const second = await ctx.processWebhook.execute({
      externalEventId: "evt-dup",
      eventType: "inquiry.completed",
      providerVerificationId: verification.providerVerificationId,
    });

    expect(second.outcome).toBe("duplicate");
    expect(ctx.provider.refreshCalls.length).toBe(refreshCallsAfterFirst); // no re-fetch happened
  });

  it("concurrent duplicate deliveries: only one claims and processes the event", async () => {
    const verification = await seedActiveCase(ctx);
    ctx.provider.nextOutcome = "VERIFIED";

    const [a, b] = await Promise.all([
      ctx.processWebhook.execute({
        externalEventId: "evt-concurrent",
        eventType: "inquiry.completed",
        providerVerificationId: verification.providerVerificationId,
      }),
      ctx.processWebhook.execute({
        externalEventId: "evt-concurrent",
        eventType: "inquiry.completed",
        providerVerificationId: verification.providerVerificationId,
      }),
    ]);

    const outcomes = [a.outcome, b.outcome].sort();
    expect(outcomes).toEqual(["duplicate", "processed"]);
  });

  it("ignores an event with no embedded inquiry id, without throwing or touching any verification", async () => {
    const result = await ctx.processWebhook.execute({
      externalEventId: "evt-no-inquiry",
      eventType: "account.created",
      providerVerificationId: null,
    });
    expect(result.outcome).toBe("ignored");
    expect(result.verificationId).toBeUndefined();
  });

  it("IDOR/BOLA safety: an unmatched providerVerificationId (never issued by this platform) is acknowledged, never processed as if it were a real case", async () => {
    const result = await ctx.processWebhook.execute({
      externalEventId: "evt-forged",
      eventType: "inquiry.completed",
      providerVerificationId: "inq_never_issued_by_this_platform",
    });
    expect(result.outcome).toBe("unmatched");
    expect(result.verificationId).toBeUndefined();
  });

  it("a failed processing attempt is re-claimable by a later retry delivery of the same event", async () => {
    const verification = await seedActiveCase(ctx);
    ctx.provider.refreshStatus = async () => {
      throw new Error("Persona is temporarily down");
    };

    await expect(
      ctx.processWebhook.execute({
        externalEventId: "evt-retry",
        eventType: "inquiry.completed",
        providerVerificationId: verification.providerVerificationId,
      }),
    ).rejects.toThrow("Persona is temporarily down");

    const failedRecord = [...ctx.webhookEvents.events.values()].find((e) => e.externalEventId === "evt-retry");
    expect(failedRecord?.status).toBe("FAILED");

    // Persona's real retry: same event id, this time the provider is healthy.
    ctx.provider.refreshStatus = async (id: string) => {
      ctx.provider.refreshCalls.push(id);
      return { providerVerificationId: id, outcome: "VERIFIED", rawStatus: "completed", checkedAt: new Date() };
    };

    const retried = await ctx.processWebhook.execute({
      externalEventId: "evt-retry",
      eventType: "inquiry.completed",
      providerVerificationId: verification.providerVerificationId,
    });
    expect(retried.outcome).toBe("processed");
    const updated = await ctx.verifications.findById(verification.id);
    expect(updated?.status).toBe("APPROVED");
  });
});
