import { describe, expect, it } from "vitest";

import type { SmsDispatchRequest } from "@/application/ports/sms-queue";
import { smsDispatchJobId, smsDispatchJobIdempotencyKey } from "@/infrastructure/sms/sms-jobs";

function request(overrides: Partial<SmsDispatchRequest> = {}): SmsDispatchRequest {
  return {
    userId: "user-1",
    phone: "+34600000000",
    type: "DISPUTE_CREATED",
    fallbackMessage: "A dispute was opened.",
    resourceId: "dispute-1",
    ...overrides,
  };
}

describe("smsDispatchJobId", () => {
  it("is deterministic for the same type/user/resourceId", () => {
    expect(smsDispatchJobId(request())).toBe(smsDispatchJobId(request()));
  });

  it("differs for a different resourceId", () => {
    expect(smsDispatchJobId(request({ resourceId: "dispute-1" }))).not.toBe(
      smsDispatchJobId(request({ resourceId: "dispute-2" })),
    );
  });

  it("generates a distinct id per call when no resourceId is present", () => {
    const a = smsDispatchJobId(request({ resourceId: undefined }));
    const b = smsDispatchJobId(request({ resourceId: undefined }));
    expect(a).not.toBe(b);
  });
});

describe("smsDispatchJobIdempotencyKey", () => {
  it("is keyed on the job's own id", () => {
    const job = { id: "job-123", queue: "sms-dispatch", name: "sms.DISPUTE_CREATED", data: request(), attempt: 1, maxAttempts: 3 };
    expect(smsDispatchJobIdempotencyKey(job)).toBe("sms:job-123");
  });
});
