import { describe, expect, it } from "vitest";

import { NullErrorReporter } from "@/application/ports/error-reporter";

describe("application/ports/error-reporter", () => {
  it("NullErrorReporter never throws for reportException, with or without context", () => {
    const reporter = new NullErrorReporter();
    expect(() => reporter.reportException(new Error("boom"))).not.toThrow();
    expect(() =>
      reporter.reportException(new Error("boom"), { tags: { a: "b" }, extra: { c: 1 } }),
    ).not.toThrow();
  });

  it("NullErrorReporter never throws for reportMessage, with or without context", () => {
    const reporter = new NullErrorReporter();
    expect(() => reporter.reportMessage("something happened")).not.toThrow();
    expect(() =>
      reporter.reportMessage("something happened", { user: { id: "u1" } }),
    ).not.toThrow();
  });
});
