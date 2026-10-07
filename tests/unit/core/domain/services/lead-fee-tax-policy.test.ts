import { describe, expect, it } from "vitest";

import {
  InvalidLeadFeeTaxBaseError,
  LEAD_FEE_IVA_RATE_BPS,
  LEAD_FEE_TAX_POLICY_VERSION,
  LEAD_FEE_TAX_ROUNDING_MODE,
  computeLeadFeeTax,
} from "@/domain/services/lead-fee-tax-policy";

describe("Module 136 — lead-fee tax policy (LEAD_V1)", () => {
  it("is 21% IVA, versioned, with an explicit ROUND_HALF_UP mode", () => {
    expect(LEAD_FEE_IVA_RATE_BPS).toBe(2100n);
    expect(LEAD_FEE_TAX_POLICY_VERSION).toBe("lead-fee-tax-policy-v1");
    expect(LEAD_FEE_TAX_ROUNDING_MODE).toBe("ROUND_HALF_UP");
    expect(computeLeadFeeTax("100.00")).toEqual({
      netAmount: "100.00",
      taxRateBps: 2100,
      taxAmount: "21.00",
      totalAmount: "121.00",
      taxPolicyVersion: "lead-fee-tax-policy-v1",
    });
  });

  it.each([
    ["5.00", "1.05", "6.05"],
    ["9.00", "1.89", "10.89"],
    ["18.00", "3.78", "21.78"],
    ["35.00", "7.35", "42.35"],
    ["52.00", "10.92", "62.92"],
    ["100.00", "21.00", "121.00"],
    ["150.00", "31.50", "181.50"],
  ])("net €%s -> IVA €%s, total €%s", (net, tax, total) => {
    const result = computeLeadFeeTax(net);
    expect(result.taxAmount).toBe(tax);
    expect(result.totalAmount).toBe(total);
  });

  // price × 0.21 has more than two decimals before rounding.
  it.each([
    ["0.01", "0.00", "0.01"], // 0.0021  -> 0.00
    ["0.02", "0.00", "0.02"], // 0.0042  -> 0.00
    ["0.03", "0.01", "0.04"], // 0.0063  -> 0.01
    ["0.50", "0.11", "0.61"], // 0.105   -> 0.11 (exact half rounds UP)
    ["1.50", "0.32", "1.82"], // 0.315   -> 0.32 (exact half rounds UP)
    ["4.99", "1.05", "6.04"], // 1.0479  -> 1.05
    ["12.34", "2.59", "14.93"], // 2.5914  -> 2.59
    ["18.05", "3.79", "21.84"], // 3.7905  -> 3.79
    ["33.33", "7.00", "40.33"], // 6.9993  -> 7.00
    ["99.99", "21.00", "120.99"], // 20.9979 -> 21.00
    ["7.25", "1.52", "8.77"], // 1.5225  -> 1.52
  ])("fractional cents: net €%s -> IVA €%s, total €%s", (net, tax, total) => {
    const result = computeLeadFeeTax(net);
    expect(result.taxAmount).toBe(tax);
    expect(result.totalAmount).toBe(total);
  });

  it("always yields two-decimal strings and total = net + tax exactly", () => {
    for (let cents = 1; cents <= 20_000; cents += 7) {
      const net = `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
      const r = computeLeadFeeTax(net);
      expect(r.taxAmount).toMatch(/^\d+\.\d{2}$/);
      expect(r.totalAmount).toMatch(/^\d+\.\d{2}$/);
      const tax = (BigInt(cents) * 2100n + 5000n) / 10000n;
      expect(BigInt(r.taxAmount.replace(".", ""))).toBe(tax);
      expect(BigInt(r.totalAmount.replace(".", ""))).toBe(BigInt(cents) + tax);
    }
  });

  it("normalises the base and accepts fewer decimals", () => {
    expect(computeLeadFeeTax("18")).toMatchObject({ netAmount: "18.00", taxAmount: "3.78", totalAmount: "21.78" });
    expect(computeLeadFeeTax("18.5")).toMatchObject({ netAmount: "18.50", taxAmount: "3.89", totalAmount: "22.39" }); // 3.885 -> 3.89
  });

  it("is deterministic and side-effect free", () => {
    const first = computeLeadFeeTax("52.00");
    for (let i = 0; i < 50; i++) expect(computeLeadFeeTax("52.00")).toEqual(first);
  });

  it.each([["0"], ["0.00"], ["-1.00"], ["1.001"], ["abc"], [""], ["1e2"], [" 5.00"], ["5,00"], [18], [null], [undefined], [{}]])(
    "rejects an invalid tax base: %j",
    (input) => {
      expect(() => computeLeadFeeTax(input)).toThrow(InvalidLeadFeeTaxBaseError);
    },
  );
});
