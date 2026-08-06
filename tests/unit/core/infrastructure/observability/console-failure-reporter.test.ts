import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConsoleFailureReporter } from "@/infrastructure/observability/console-failure-reporter";

describe("infrastructure/observability/console-failure-reporter", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("routes the failure through the structured logger at error level", () => {
    const reporter = new ConsoleFailureReporter();
    const error = new Error("simulated subscriber failure");

    reporter.report(error, { eventName: "company.status-changed", eventId: "evt-1" });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(errorSpy.mock.calls[0]![0] as string);
    expect(entry.level).toBe("error");
    expect(entry.event).toBe("event-subscriber.failure");
    expect(entry.eventName).toBe("company.status-changed");
    expect(entry.eventId).toBe("evt-1");
    expect(entry.error.message).toBe("simulated subscriber failure");
  });

  it("works without a context object", () => {
    const reporter = new ConsoleFailureReporter();
    expect(() => reporter.report(new Error("boom"))).not.toThrow();
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});
