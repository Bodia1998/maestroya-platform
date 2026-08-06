import { describe, expect, it } from "vitest";

import { SuspendCompanyUseCase } from "@/application/use-cases/admin/suspend-company.use-case";
import { ReactivateCompanyUseCase } from "@/application/use-cases/admin/reactivate-company.use-case";
import { RecordCompanyStatusChangeAuditLogSubscriber } from "@/application/use-cases/admin/record-company-status-change-audit-log.subscriber";
import { NotifyCompanyStatusChangeSubscriber } from "@/application/use-cases/notification/notify-company-status-change.subscriber";
import { CompanyStatusChanged } from "@/domain/events/company-status-changed";
import { SynchronousEventBus } from "@/infrastructure/events/synchronous-event-bus";
import { EventDispatchError } from "@/application/ports/event-dispatch-error";
import type { FailureReporter } from "@/application/ports/failure-reporter";
import { NullFailureReporter } from "@/application/ports/failure-reporter";
import type { NotificationCreator, NotificationEvent } from "@/application/ports/notification-creator";
import { FakeAdminRepository, FakeAdminAuditLogRepository } from "./fakes";

/**
 * Module 37 — Domain Event Subscribers (Notifications & Audit Log).
 *
 * End-to-end coverage for the `CompanyStatusChanged` flow: real use cases
 * (`SuspendCompanyUseCase`/`ReactivateCompanyUseCase`), a real
 * `SynchronousEventBus` (Module 34), and the real subscribers — only the
 * outermost repositories/notification port are fakes. Exercises exactly
 * the scenarios the module brief calls out: registration, execution on
 * publish, both subscriber types, multiple subscribers reacting to one
 * event, no-subscriber safety, failure propagation, and
 * `EventDispatchError`'s shape.
 */

class RecordingNotificationCreator implements NotificationCreator {
  events: NotificationEvent[] = [];
  async notify(event: NotificationEvent): Promise<void> {
    this.events.push(event);
  }
}

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

function buildBus(auditLog: FakeAdminAuditLogRepository, notifications: NotificationCreator) {
  const bus = new SynchronousEventBus();
  bus.subscribe(CompanyStatusChanged, new RecordCompanyStatusChangeAuditLogSubscriber(auditLog));
  bus.subscribe(CompanyStatusChanged, new NotifyCompanyStatusChangeSubscriber(notifications));
  return bus;
}

describe("CompanyStatusChanged: SuspendCompanyUseCase/ReactivateCompanyUseCase publish, subscribers react", () => {
  it("suspending a company runs both the audit-log and notification subscribers for the same published event", async () => {
    const admins = new FakeAdminRepository();
    const auditLog = new FakeAdminAuditLogRepository();
    const notifications = new RecordingNotificationCreator();
    const bus = buildBus(auditLog, notifications);

    const company = admins.seedCompany({ ownerUserId: "owner-1", status: "ACTIVE" });
    const useCase = new SuspendCompanyUseCase(admins, bus);

    const updated = await useCase.execute("admin-1", company.id);

    expect(updated.status).toBe("SUSPENDED");
    // Audit-log subscriber ran.
    expect(auditLog.entries).toHaveLength(1);
    expect(auditLog.entries[0]).toMatchObject({ action: "COMPANY_SUSPENDED", targetId: company.id });
    // Notification subscriber ran too — both react to the one event.
    expect(notifications.events).toHaveLength(1);
    expect(notifications.events[0]).toMatchObject({ userId: "owner-1", type: "COMPANY_SUSPENDED" });
  });

  it("reactivating a company runs both subscribers with COMPANY_REACTIVATED semantics", async () => {
    const admins = new FakeAdminRepository();
    const auditLog = new FakeAdminAuditLogRepository();
    const notifications = new RecordingNotificationCreator();
    const bus = buildBus(auditLog, notifications);

    const company = admins.seedCompany({ ownerUserId: "owner-1", status: "SUSPENDED" });
    const useCase = new ReactivateCompanyUseCase(admins, bus);

    const updated = await useCase.execute("admin-1", company.id);

    expect(updated.status).toBe("ACTIVE");
    expect(auditLog.entries[0]).toMatchObject({ action: "COMPANY_REACTIVATED", targetId: company.id });
    expect(notifications.events[0]).toMatchObject({ userId: "owner-1", type: "COMPANY_REACTIVATED" });
  });

  it("publishing with no subscribers registered does not throw (EventBus's own no-subscriber contract)", async () => {
    const admins = new FakeAdminRepository();
    const bus = new SynchronousEventBus(); // nothing subscribed
    const company = admins.seedCompany({ ownerUserId: "owner-1", status: "ACTIVE" });
    const useCase = new SuspendCompanyUseCase(admins, bus);

    await expect(useCase.execute("admin-1", company.id)).resolves.toMatchObject({ status: "SUSPENDED" });
  });

  it("a failing subscriber never fails the use case, corrupts the already-persisted status, or throws uncaught", async () => {
    const admins = new FakeAdminRepository();
    const auditLog = new FakeAdminAuditLogRepository();
    const bus = buildBus(auditLog, new ThrowingNotificationCreator());
    const failureReporter = new RecordingFailureReporter();

    const company = admins.seedCompany({ ownerUserId: "owner-1", status: "ACTIVE" });
    const useCase = new SuspendCompanyUseCase(admins, bus, failureReporter);

    const updated = await useCase.execute("admin-1", company.id);

    // Primary operation still succeeded and is reflected in the repository.
    expect(updated.status).toBe("SUSPENDED");
    expect((await admins.getCompanyById(company.id))?.status).toBe("SUSPENDED");
    // The sibling audit-log subscriber still ran despite the notification
    // subscriber throwing (SynchronousEventBus runs every handler).
    expect(auditLog.entries).toHaveLength(1);
    // The failure was routed through FailureReporter, not swallowed silently
    // and not rethrown past execute().
    expect(failureReporter.reports).toHaveLength(1);
    expect(failureReporter.reports[0]?.error).toBeInstanceOf(EventDispatchError);
    const dispatchError = failureReporter.reports[0]?.error as EventDispatchError;
    expect(dispatchError.eventName).toBe("company.status-changed");
    expect(dispatchError.failures).toEqual([
      { handlerName: "NotifyCompanyStatusChangeSubscriber", error: expect.any(Error) },
    ]);
  });

  it("defaults to NullFailureReporter (no throw, no console noise) when none is supplied", async () => {
    const admins = new FakeAdminRepository();
    const auditLog = new FakeAdminAuditLogRepository();
    const bus = buildBus(auditLog, new ThrowingNotificationCreator());

    const company = admins.seedCompany({ ownerUserId: "owner-1", status: "ACTIVE" });
    const useCase = new SuspendCompanyUseCase(admins, bus); // no third argument

    await expect(useCase.execute("admin-1", company.id)).resolves.toMatchObject({ status: "SUSPENDED" });
  });

  it("an unexpected (non-EventDispatchError) error from eventBus.publishAll is rethrown, not swallowed", async () => {
    const admins = new FakeAdminRepository();
    const bus = {
      publish: async () => undefined,
      publishAll: async () => {
        throw new Error("totally unrelated infrastructure failure");
      },
      subscribe: () => undefined,
    };
    const company = admins.seedCompany({ ownerUserId: "owner-1", status: "ACTIVE" });
    const useCase = new SuspendCompanyUseCase(admins, bus);

    await expect(useCase.execute("admin-1", company.id)).rejects.toThrow("totally unrelated infrastructure failure");
  });
});

describe("NullFailureReporter", () => {
  it("is a safe do-nothing default", () => {
    const reporter = new NullFailureReporter();
    expect(() => reporter.report(new Error("x"))).not.toThrow();
  });
});
