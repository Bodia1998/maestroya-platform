import { describe, expect, it } from "vitest";

import { NullFailureReporter } from "@/application/ports/failure-reporter";

describe("application/ports/failure-reporter", () => {
  it("NullFailureReporter.report never throws, regardless of input", () => {
    const reporter = new NullFailureReporter();
    expect(() => reporter.report(new Error("boom"))).not.toThrow();
    expect(() => reporter.report("plain string error", { eventName: "x" })).not.toThrow();
    expect(() => reporter.report(undefined)).not.toThrow();
  });
});
