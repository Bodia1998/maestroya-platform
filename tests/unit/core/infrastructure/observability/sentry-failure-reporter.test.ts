import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SentryFailureReporter } from "@/infrastructure/observability/sentry-failure-reporter";
import type { ErrorReportContext, ErrorReporter } from "@/application/ports/error-reporter";

class RecordingErrorReporter implements ErrorReporter {
  exceptions: Array<{ error: unknown; context?: ErrorReportContext }> = [];
  messages: Array<{ message: string; context?: ErrorReportContext }> = [];

  reportException(error: unknown, context?: ErrorReportContext): void {
    this.exceptions.push({ error, context });
  }

  reportMessage(message: string, context?: ErrorReportContext): void {
    this.messages.push({ message, context });
  }
}

describe("infrastructure/observability/sentry-failure-reporter", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("forwards the failure to the underlying ErrorReporter with eventName/eventId tags", () => {
    const errorReporter = new RecordingErrorReporter();
    const reporter = new SentryFailureReporter(errorReporter);
    const error = new Error("subscriber failed");

    reporter.report(error, { event: "company.status-changed", eventId: "evt-1" });

    expect(errorReporter.exceptions).toHaveLength(1);
    const { error: reportedError, context } = errorReporter.exceptions[0]!;
    expect(reportedError).toBe(error);
    expect(context?.tags?.eventName).toBe("company.status-changed");
    expect(context?.tags?.eventId).toBe("evt-1");
    expect(context?.tags?.source).toBe("event-subscriber");
  });

  it("still logs through the structured logger (same event name as ConsoleFailureReporter)", () => {
    const reporter = new SentryFailureReporter(new RecordingErrorReporter());
    reporter.report(new Error("subscriber failed"), { event: "x", eventId: "1" });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(errorSpy.mock.calls[0]![0] as string);
    expect(entry.event).toBe("event-subscriber.failure");
  });

  it("extracts EventDispatchError's failures array into extra context", () => {
    const errorReporter = new RecordingErrorReporter();
    const reporter = new SentryFailureReporter(errorReporter);
    const dispatchError = Object.assign(new Error("2 handler(s) failed"), {
      eventName: "company.status-changed",
      eventId: "evt-2",
      failures: [{ handlerName: "NotifySubscriber", error: new Error("boom") }],
    });

    reporter.report(dispatchError, { event: dispatchError.eventName, eventId: dispatchError.eventId });

    const { context } = errorReporter.exceptions[0]!;
    expect(context?.extra?.failures).toEqual(dispatchError.failures);
  });

  it("works without a context object", () => {
    const errorReporter = new RecordingErrorReporter();
    const reporter = new SentryFailureReporter(errorReporter);
    expect(() => reporter.report(new Error("boom"))).not.toThrow();
    expect(errorReporter.exceptions).toHaveLength(1);
  });
});
