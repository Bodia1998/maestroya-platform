import { describe, expect, it } from "vitest";

import { NullVerificationProvider } from "@/infrastructure/verification/null-verification-provider";

describe("NullVerificationProvider (Module 59)", () => {
  it("reports MANUAL as its provider name", () => {
    expect(new NullVerificationProvider().name).toBe("MANUAL");
  });

  it("throws VerificationProviderNotConfiguredError on every mutating method", async () => {
    const provider = new NullVerificationProvider();
    await expect(provider.createVerification({ verificationId: "x", fullName: "A B", countryCode: "ES" })).rejects.toThrow(
      /VERIFICATION_PROVIDER is "manual"/,
    );
    await expect(provider.getVerification("x")).rejects.toThrow();
    await expect(provider.refreshStatus("x")).rejects.toThrow();
    await expect(provider.generateVerificationLink("x")).rejects.toThrow();
  });

  it("webhookValidation always reports invalid", () => {
    expect(new NullVerificationProvider().webhookValidation("{}", "sig").valid).toBe(false);
  });
});
