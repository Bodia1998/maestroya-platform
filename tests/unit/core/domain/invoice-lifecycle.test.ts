import { describe, expect, it } from "vitest";
import {
  canTransitionInvoiceStatus,
  isCreditableInvoiceStatus,
  isEditableInvoiceStatus,
  isImmutableInvoiceStatus,
  satisfiesPayoutInvoicePrerequisite,
} from "@/domain/services/invoice-lifecycle";
import type { InvoiceStatusValue } from "@/domain/repositories/invoice-repository";

const ALL_STATUSES: InvoiceStatusValue[] = ["DRAFT", "PENDING_ACCEPTANCE", "ACCEPTED", "ISSUED", "PAID", "CANCELLED"];

describe("invoice-lifecycle", () => {
  it("allows the documented DRAFT -> PENDING_ACCEPTANCE -> ACCEPTED -> ISSUED -> PAID path", () => {
    expect(canTransitionInvoiceStatus("DRAFT", "PENDING_ACCEPTANCE")).toBe(true);
    expect(canTransitionInvoiceStatus("PENDING_ACCEPTANCE", "ACCEPTED")).toBe(true);
    expect(canTransitionInvoiceStatus("ACCEPTED", "ISSUED")).toBe(true);
    expect(canTransitionInvoiceStatus("ISSUED", "PAID")).toBe(true);
  });

  it("allows cancellation only from DRAFT/PENDING_ACCEPTANCE", () => {
    expect(canTransitionInvoiceStatus("DRAFT", "CANCELLED")).toBe(true);
    expect(canTransitionInvoiceStatus("PENDING_ACCEPTANCE", "CANCELLED")).toBe(true);
    expect(canTransitionInvoiceStatus("ACCEPTED", "CANCELLED")).toBe(false);
    expect(canTransitionInvoiceStatus("ISSUED", "CANCELLED")).toBe(false);
    expect(canTransitionInvoiceStatus("PAID", "CANCELLED")).toBe(false);
  });

  it("rejects every transition out of ISSUED except to PAID", () => {
    for (const to of ALL_STATUSES) {
      if (to === "PAID") continue;
      expect(canTransitionInvoiceStatus("ISSUED", to)).toBe(false);
    }
  });

  it("rejects every transition out of PAID and CANCELLED (both terminal)", () => {
    for (const to of ALL_STATUSES) {
      expect(canTransitionInvoiceStatus("PAID", to)).toBe(false);
      expect(canTransitionInvoiceStatus("CANCELLED", to)).toBe(false);
    }
  });

  it("rejects skipping a step (DRAFT straight to ACCEPTED/ISSUED/PAID)", () => {
    expect(canTransitionInvoiceStatus("DRAFT", "ACCEPTED")).toBe(false);
    expect(canTransitionInvoiceStatus("DRAFT", "ISSUED")).toBe(false);
    expect(canTransitionInvoiceStatus("DRAFT", "PAID")).toBe(false);
  });

  it("rejects every no-op (status, status) transition", () => {
    for (const status of ALL_STATUSES) {
      expect(canTransitionInvoiceStatus(status, status)).toBe(false);
    }
  });

  it("treats only DRAFT as editable", () => {
    expect(isEditableInvoiceStatus("DRAFT")).toBe(true);
    for (const status of ALL_STATUSES) {
      if (status === "DRAFT") continue;
      expect(isEditableInvoiceStatus(status)).toBe(false);
    }
  });

  it("treats ISSUED and PAID as immutable", () => {
    expect(isImmutableInvoiceStatus("ISSUED")).toBe(true);
    expect(isImmutableInvoiceStatus("PAID")).toBe(true);
    expect(isImmutableInvoiceStatus("DRAFT")).toBe(false);
    expect(isImmutableInvoiceStatus("PENDING_ACCEPTANCE")).toBe(false);
    expect(isImmutableInvoiceStatus("ACCEPTED")).toBe(false);
  });

  it("treats only ISSUED/PAID as creditable", () => {
    expect(isCreditableInvoiceStatus("ISSUED")).toBe(true);
    expect(isCreditableInvoiceStatus("PAID")).toBe(true);
    expect(isCreditableInvoiceStatus("DRAFT")).toBe(false);
    expect(isCreditableInvoiceStatus("PENDING_ACCEPTANCE")).toBe(false);
    expect(isCreditableInvoiceStatus("ACCEPTED")).toBe(false);
    expect(isCreditableInvoiceStatus("CANCELLED")).toBe(false);
  });

  it("requires ISSUED (not merely ACCEPTED) or PAID to satisfy the payout prerequisite", () => {
    expect(satisfiesPayoutInvoicePrerequisite(null)).toBe(false);
    expect(satisfiesPayoutInvoicePrerequisite("DRAFT")).toBe(false);
    expect(satisfiesPayoutInvoicePrerequisite("PENDING_ACCEPTANCE")).toBe(false);
    expect(satisfiesPayoutInvoicePrerequisite("ACCEPTED")).toBe(false);
    expect(satisfiesPayoutInvoicePrerequisite("ISSUED")).toBe(true);
    expect(satisfiesPayoutInvoicePrerequisite("PAID")).toBe(true);
    expect(satisfiesPayoutInvoicePrerequisite("CANCELLED")).toBe(false);
  });
});
