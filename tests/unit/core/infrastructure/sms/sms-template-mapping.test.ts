import { describe, expect, it } from "vitest";

import { buildSmsBody } from "@/infrastructure/sms/sms-template-mapping";
import { SMS_SINGLE_SEGMENT_LIMIT } from "@/infrastructure/sms/sms-template-renderer";
import type { SmsDispatchJobData } from "@/infrastructure/sms/sms-jobs";

function job(overrides: Partial<SmsDispatchJobData> = {}): SmsDispatchJobData {
  return {
    userId: "user-1",
    phone: "+34600000000",
    type: "QUOTE_ACCEPTED",
    fallbackMessage: "Your quote has been accepted.",
    locale: "en",
    ...overrides,
  };
}

describe("buildSmsBody", () => {
  it("uses the mapped template and metadata for a known notification type", () => {
    const body = buildSmsBody(job({ type: "QUOTE_ACCEPTED", metadata: { amount: "€120" } }));
    expect(body).toBe("Your quote for €120 has been accepted. MaestroYa");
  });

  it("maps DISPUTE_CREATED to the disputeNotification template", () => {
    const body = buildSmsBody(job({ type: "DISPUTE_CREATED", metadata: { caseNumber: "D-1001" } }));
    expect(body).toContain("D-1001");
  });

  it("falls back to the truncated generic message for an unmapped notification type", () => {
    const body = buildSmsBody(job({ type: "REVIEW_RECEIVED", fallbackMessage: "You received a new review." }));
    expect(body).toBe("You received a new review.");
  });

  it("truncates a long fallback message to a single SMS segment", () => {
    const longMessage = "x".repeat(SMS_SINGLE_SEGMENT_LIMIT + 50);
    const body = buildSmsBody(job({ type: "UNMAPPED_TYPE", fallbackMessage: longMessage }));
    expect(body.length).toBe(SMS_SINGLE_SEGMENT_LIMIT);
    expect(body.endsWith("…")).toBe(true);
  });

  it("does not truncate a fallback message that already fits one segment", () => {
    const message = "Short message.";
    const body = buildSmsBody(job({ type: "UNMAPPED_TYPE", fallbackMessage: message }));
    expect(body).toBe(message);
  });

  it("uses the job's locale to select the rendered language", () => {
    const body = buildSmsBody(job({ type: "QUOTE_REJECTED", locale: "es" }));
    expect(body).toBe("Tu presupuesto ha sido rechazado. MaestroYa");
  });

  it("leaves an unresolved placeholder rather than throwing when metadata is missing a value", () => {
    const body = buildSmsBody(job({ type: "QUOTE_ACCEPTED", metadata: undefined }));
    expect(body).toContain("{amount}");
  });
});
