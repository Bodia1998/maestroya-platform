import { describe, expect, it } from "vitest";
import { computeDocumentHash, formatCreditNoteNumber, formatInvoiceNumber } from "@/domain/services/invoice-document";

describe("invoice-document", () => {
  it("formats invoice numbers as INV-<year>-<zero-padded sequence>", () => {
    expect(formatInvoiceNumber({ year: 2026, sequence: 1 })).toBe("INV-2026-000001");
    expect(formatInvoiceNumber({ year: 2026, sequence: 123 })).toBe("INV-2026-000123");
  });

  it("formats credit note numbers with a distinct CN- prefix from invoice numbers", () => {
    expect(formatCreditNoteNumber({ year: 2026, sequence: 45 })).toBe("CN-2026-000045");
    expect(formatCreditNoteNumber({ year: 2026, sequence: 1 })).not.toBe(formatInvoiceNumber({ year: 2026, sequence: 1 }));
  });

  it("rejects an invalid sequence or year", () => {
    expect(() => formatInvoiceNumber({ year: 2026, sequence: 0 })).toThrow(RangeError);
    expect(() => formatInvoiceNumber({ year: 2026, sequence: -1 })).toThrow(RangeError);
    expect(() => formatInvoiceNumber({ year: 99, sequence: 1 })).toThrow(RangeError);
  });

  it("computes a deterministic hash for the same payload", () => {
    const payload = { a: 1, b: "two", c: [1, 2, 3] };
    expect(computeDocumentHash(payload)).toBe(computeDocumentHash(payload));
  });

  it("computes the same hash regardless of key insertion order", () => {
    const a = computeDocumentHash({ a: 1, b: 2, c: { x: 1, y: 2 } });
    const b = computeDocumentHash({ c: { y: 2, x: 1 }, b: 2, a: 1 });
    expect(a).toBe(b);
  });

  it("computes a different hash when any financial value changes", () => {
    const a = computeDocumentHash({ totalAmount: 1306.8 });
    const b = computeDocumentHash({ totalAmount: 1306.81 });
    expect(a).not.toBe(b);
  });

  it("produces a 64-character hex SHA-256 digest", () => {
    const hash = computeDocumentHash({ x: 1 });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
