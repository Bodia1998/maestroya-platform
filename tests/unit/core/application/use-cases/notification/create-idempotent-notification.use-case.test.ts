import { describe, expect, it, vi } from "vitest";

import { ValidationError } from "@/domain/errors/domain-error";
import type { IdempotentNotificationData, IdempotentNotificationWriter, NotificationRecord } from "@/domain/repositories/notification-repository";
import { CreateIdempotentNotificationUseCase } from "@/application/use-cases/notification/create-idempotent-notification.use-case";

/** Module 145 — validation parity with CreateNotificationUseCase + key rules. Persistence atomicity is covered against real PostgreSQL. */
const record = (data: IdempotentNotificationData): NotificationRecord => ({
  id: "n-1", userId: data.userId, type: data.type, title: data.title, message: data.message, resourceType: data.resourceType, resourceId: data.resourceId,
  actionUrl: data.actionUrl, metadata: data.metadata, readAt: null, dismissedAt: null, createdAt: new Date(), updatedAt: new Date(),
});

const input = (over: Record<string, unknown> = {}) => ({
  userId: "u-1",
  type: "LEAD_PURCHASE_CONFIRMED" as const,
  title: "  Payment confirmed ",
  message: "Your payment is confirmed.",
  actionUrl: "/dashboard/professional/leads/x/purchase",
  metadata: { city: "Madrid" },
  dedupeKey: "lead-v1:purchase-confirmed:p-1:professional",
  ...over,
});

function writer() {
  const createIfAbsent = vi.fn(async (data: IdempotentNotificationData) => ({ notification: record(data), created: true }));
  return { createIfAbsent } as IdempotentNotificationWriter & { createIfAbsent: ReturnType<typeof vi.fn> };
}

describe("CreateIdempotentNotificationUseCase", () => {
  it("normalizes like the plain use case and forwards the key", async () => {
    const w = writer();
    const result = await new CreateIdempotentNotificationUseCase(w).execute(input());
    expect(result.created).toBe(true);
    expect(w.createIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Payment confirmed", resourceType: null, resourceId: null, dedupeKey: "lead-v1:purchase-confirmed:p-1:professional" }),
    );
  });

  it.each(["", "   ", "x".repeat(192)])("rejects an invalid dedupe key (%j) before touching storage", async (dedupeKey) => {
    const w = writer();
    await expect(new CreateIdempotentNotificationUseCase(w).execute(input({ dedupeKey }))).rejects.toBeInstanceOf(ValidationError);
    expect(w.createIfAbsent).not.toHaveBeenCalled();
  });

  it("rejects an unsafe action URL, an empty title and an oversized message (same rules as the plain path)", async () => {
    const w = writer();
    const uc = new CreateIdempotentNotificationUseCase(w);
    await expect(uc.execute(input({ actionUrl: "https://evil.example" }))).rejects.toBeInstanceOf(ValidationError);
    await expect(uc.execute(input({ title: "  " }))).rejects.toBeInstanceOf(ValidationError);
    await expect(uc.execute(input({ message: "m".repeat(2001) }))).rejects.toBeInstanceOf(ValidationError);
    expect(w.createIfAbsent).not.toHaveBeenCalled();
  });

  it("reports created:false when the writer found the existing row", async () => {
    const w = { createIfAbsent: vi.fn(async (d: IdempotentNotificationData) => ({ notification: record(d), created: false })) } as IdempotentNotificationWriter;
    expect((await new CreateIdempotentNotificationUseCase(w).execute(input())).created).toBe(false);
  });
});
