import { describe, expect, it, vi } from "vitest";

import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import { PaymentCaptured } from "@/domain/events/payment-captured";
import { RecordCommissionOnPaymentCapturedSubscriber } from "@/application/use-cases/payments/record-commission-on-payment-captured.subscriber";
import type { RecordCommissionForPaymentUseCase } from "@/application/use-cases/financial/record-commission-for-payment.use-case";

/**
 * Module 73 — Real Customer Payment Capture: tests for
 * `RecordCommissionOnPaymentCapturedSubscriber` — the
 * `PaymentCaptured` -> `RecordCommissionForPaymentUseCase` wiring
 * `payment-captured.ts`'s own doc comment documents as the planned
 * consumer.
 */
function fakeRecordCommission(execute: (paymentId: string) => Promise<unknown>): RecordCommissionForPaymentUseCase {
  return { execute } as unknown as RecordCommissionForPaymentUseCase;
}

describe("RecordCommissionOnPaymentCapturedSubscriber (Module 73)", () => {
  it("calls RecordCommissionForPaymentUseCase.execute with the captured payment's id", async () => {
    const execute = vi.fn().mockResolvedValue({ id: "commission-1" });
    const subscriber = new RecordCommissionOnPaymentCapturedSubscriber(fakeRecordCommission(execute));

    await subscriber.handle(new PaymentCaptured("payment-1", 100, "EUR"));

    expect(execute).toHaveBeenCalledWith("payment-1");
  });

  it("swallows the expected 'not yet release-approved' ValidationError without rethrowing", async () => {
    const execute = vi.fn().mockRejectedValue(new ValidationError("This payment has not been approved for release yet."));
    const subscriber = new RecordCommissionOnPaymentCapturedSubscriber(fakeRecordCommission(execute));

    await expect(subscriber.handle(new PaymentCaptured("payment-1", 100, "EUR"))).resolves.toBeUndefined();
  });

  it("rethrows any other error (a genuine failure, not the expected release-gate case)", async () => {
    const execute = vi.fn().mockRejectedValue(new NotFoundError("Payment", "payment-1"));
    const subscriber = new RecordCommissionOnPaymentCapturedSubscriber(fakeRecordCommission(execute));

    await expect(subscriber.handle(new PaymentCaptured("payment-1", 100, "EUR"))).rejects.toBeInstanceOf(NotFoundError);
  });
});
