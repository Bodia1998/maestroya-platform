import { describe, expect, it } from "vitest";

import { SubmitProfessionalVerificationUseCase } from "@/application/use-cases/verification/submit-professional-verification.use-case";
import { RecordProfessionalVerificationAuditLogSubscriber } from "@/application/use-cases/verification/record-professional-verification-audit-log.subscriber";
import { NotifyProfessionalVerificationStatusChangeSubscriber } from "@/application/use-cases/notification/notify-professional-verification-status-change.subscriber";
import { ProfessionalVerificationStatusChanged } from "@/domain/events/professional-verification-status-changed";
import { SynchronousEventBus } from "@/infrastructure/events/synchronous-event-bus";
import { EventDispatchError } from "@/application/ports/event-dispatch-error";
import type { FailureReporter } from "@/application/ports/failure-reporter";
import type { NotificationCreator } from "@/application/ports/notification-creator";
import { FakeAdminAuditLogRepository, FakeProfessionalRepository, FakeProfessionalVerificationRepository } from "./fakes";

/**
 * Module 37 — Domain Event Subscribers (Notifications & Audit Log).
 *
 * Failure-propagation coverage for `ProfessionalVerificationStatusChanged`,
 * mirroring tests/integration/admin/company-status-change-events.test.ts:
 * a failing subscriber must never fail the publishing use case or corrupt
 * the already-persisted state change, and must be routed through
 * `FailureReporter`. verification-flows.test.ts already covers the
 * happy-path audit+notification content for every transition.
 */

class ThrowingNotificationCreator implements NotificationCreator {
  async notify(): Promise<void> {
    throw new Error("notification service outage");
  }
}

class RecordingFailureReporter implements FailureReporter {
  reports: { error: unknown; context?: Record<string, unknown> }[] = [];
  report(error: unknown, context?: Record<string, unknown>): void {
    this.reports.push({ error, context });
  }
}

describe("ProfessionalVerificationStatusChanged: SubmitProfessionalVerificationUseCase publishes, subscribers react", () => {
  it("a failing notification subscriber never fails the use case, corrupts the persisted status, or throws uncaught", async () => {
    const professionals = new FakeProfessionalRepository();
    const verifications = new FakeProfessionalVerificationRepository(professionals);
    const auditLog = new FakeAdminAuditLogRepository();
    const failureReporter = new RecordingFailureReporter();

    const bus = new SynchronousEventBus();
    bus.subscribe(ProfessionalVerificationStatusChanged, new RecordProfessionalVerificationAuditLogSubscriber(auditLog));
    bus.subscribe(
      ProfessionalVerificationStatusChanged,
      new NotifyProfessionalVerificationStatusChangeSubscriber(new ThrowingNotificationCreator()),
    );

    const professional = professionals.seed({ userId: "pro-1", status: "ACTIVE" });
    const verification = await verifications.create(professional.id);
    await verifications.addDocument({
      verificationId: verification.id,
      type: "NATIONAL_ID",
      fileUrl: "https://example.com/doc.png",
      originalFilename: "doc.png",
      mimeType: "image/png",
      fileSizeBytes: 10,
    });

    const useCase = new SubmitProfessionalVerificationUseCase(verifications, professionals, bus, failureReporter);
    const updated = await useCase.execute("pro-1");

    expect(updated.status).toBe("PENDING");
    // Primary operation still succeeded and is reflected in the repository.
    expect((await verifications.findById(verification.id))?.status).toBe("PENDING");
    // The sibling audit-log subscriber still ran despite the notification
    // subscriber throwing (SynchronousEventBus runs every handler).
    expect(auditLog.actions()).toContain("VERIFICATION_SUBMITTED");
    // The failure was routed through FailureReporter, not swallowed
    // silently and not rethrown past execute().
    expect(failureReporter.reports).toHaveLength(1);
    expect(failureReporter.reports[0]?.error).toBeInstanceOf(EventDispatchError);
    const dispatchError = failureReporter.reports[0]?.error as EventDispatchError;
    expect(dispatchError.eventName).toBe("professional-verification.status-changed");
    expect(dispatchError.failures).toEqual([
      { handlerName: "NotifyProfessionalVerificationStatusChangeSubscriber", error: expect.any(Error) },
    ]);
  });

  it("publishing with no subscribers registered does not throw (EventBus's own no-subscriber contract)", async () => {
    const professionals = new FakeProfessionalRepository();
    const verifications = new FakeProfessionalVerificationRepository(professionals);
    const bus = new SynchronousEventBus(); // nothing subscribed

    const professional = professionals.seed({ userId: "pro-2", status: "ACTIVE" });
    const verification = await verifications.create(professional.id);
    await verifications.addDocument({
      verificationId: verification.id,
      type: "NATIONAL_ID",
      fileUrl: "https://example.com/doc.png",
      originalFilename: "doc.png",
      mimeType: "image/png",
      fileSizeBytes: 10,
    });

    const useCase = new SubmitProfessionalVerificationUseCase(verifications, professionals, bus);
    await expect(useCase.execute("pro-2")).resolves.toMatchObject({ status: "PENDING" });
  });
});
