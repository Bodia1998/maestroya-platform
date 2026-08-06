import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConsoleErrorReporter } from "@/infrastructure/observability/console-error-reporter";

describe("infrastructure/observability/console-error-reporter", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("routes an exception through the structured logger at error level", () => {
    const reporter = new ConsoleErrorReporter();
    const error = new Error("simulated unexpected failure");

    reporter.reportException(error, { tags: { route: "/api/test" }, extra: { requestId: "req-1" } });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(errorSpy.mock.calls[0]![0] as string);
    expect(entry.level).toBe("error");
    expect(entry.event).toBe("error-reporter.exception");
    expect(entry.tags.route).toBe("/api/test");
    expect(entry.extra.requestId).toBe("req-1");
    expect(entry.error.message).toBe("simulated unexpected failure");
  });

  it("routes a message through the structured logger at error level", () => {
    const reporter = new ConsoleErrorReporter();
    reporter.reportMessage("diagnostic note");

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(errorSpy.mock.calls[0]![0] as string);
    expect(entry.event).toBe("error-reporter.message");
    expect(entry.message).toBe("diagnostic note");
  });

  it("works without a context object", () => {
    const reporter = new ConsoleErrorReporter();
    expect(() => reporter.reportException(new Error("boom"))).not.toThrow();
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});
