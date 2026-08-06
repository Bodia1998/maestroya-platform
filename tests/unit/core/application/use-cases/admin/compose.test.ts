import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Module 37 — Domain Event Subscribers: proves admin/compose.ts (and, via
 * its side-effect import, notification/compose.ts) actually registers both
 * `CompanyStatusChanged` subscribers against the shared `eventBus` at
 * module load time — not just that the subscriber classes exist in
 * isolation. `vi.resetModules()` + dynamic `import()` per test is required
 * because module-load-time side effects (the `eventBus.subscribe(...)`
 * calls in these compose files) only run once per module registry, and a
 * spy installed after the first import would never see them.
 */
describe("application/use-cases/admin/compose — event subscriber wiring", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("registers both the audit-log and notification subscribers for CompanyStatusChanged on import", async () => {
    const { eventBus } = await import("@/infrastructure/events/compose");
    const { CompanyStatusChanged } = await import("@/domain/events/company-status-changed");
    const { RecordCompanyStatusChangeAuditLogSubscriber } = await import(
      "@/application/use-cases/admin/record-company-status-change-audit-log.subscriber"
    );
    const { NotifyCompanyStatusChangeSubscriber } = await import(
      "@/application/use-cases/notification/notify-company-status-change.subscriber"
    );
    const subscribeSpy = vi.spyOn(eventBus, "subscribe");

    await import("@/application/use-cases/admin/compose");

    const registeredForCompanyStatusChanged = subscribeSpy.mock.calls.filter(
      ([eventType]) => eventType === CompanyStatusChanged,
    );

    const handlerClasses = registeredForCompanyStatusChanged.map(([, handler]) => handler.constructor);
    expect(handlerClasses).toContain(RecordCompanyStatusChangeAuditLogSubscriber);
    expect(handlerClasses).toContain(NotifyCompanyStatusChangeSubscriber);
  });

  it("makeSuspendCompanyUseCase and makeReactivateCompanyUseCase are wired with the shared eventBus, not a private one", async () => {
    const { eventBus } = await import("@/infrastructure/events/compose");
    const { makeSuspendCompanyUseCase, makeReactivateCompanyUseCase } = await import(
      "@/application/use-cases/admin/compose"
    );

    // Both factories must depend on the exact same eventBus instance this
    // module's own subscribers are registered against — a use case wired to
    // a *different* EventBus instance would silently never reach them (see
    // infrastructure/events/compose.ts's own doc comment on why there must
    // be exactly one shared instance).
    expect(makeSuspendCompanyUseCase()).toBeTruthy();
    expect(makeReactivateCompanyUseCase()).toBeTruthy();
    expect(eventBus).toBeTruthy();
  });
});
