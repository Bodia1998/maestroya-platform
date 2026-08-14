import { describe, expect, it } from "vitest";

import {
  detectPricingSplitAnomaly,
  detectExtremeQuoteModification,
  detectRepeatedPricingAnomalies,
  VERY_LOW_LABOUR_RATIO,
  EXTREME_QUOTE_MODIFICATION_RATIO,
} from "@/domain/services/suspicious-pricing-detection-rules";

describe("Module 65 — detectPricingSplitAnomaly", () => {
  it("flags very low labour", () => {
    const findings = detectPricingSplitAnomaly({ labour: 1, materials: 999, total: 1000 });
    expect(findings.some((f) => f.reason === "VERY_LOW_LABOUR")).toBe(true);
  });

  it("flags very high materials", () => {
    const findings = detectPricingSplitAnomaly({ labour: 1, materials: 999, total: 1000 });
    expect(findings.some((f) => f.reason === "VERY_HIGH_MATERIALS")).toBe(true);
  });

  it("does not flag a balanced split", () => {
    const findings = detectPricingSplitAnomaly({ labour: 500, materials: 500, total: 1000 });
    expect(findings).toEqual([]);
  });

  it("does not flag a zero-total quote (avoids division by zero)", () => {
    expect(detectPricingSplitAnomaly({ labour: 0, materials: 0, total: 0 })).toEqual([]);
  });

  it("respects VERY_LOW_LABOUR_RATIO as the exact boundary", () => {
    const total = 1000;
    const labour = total * VERY_LOW_LABOUR_RATIO;
    const findings = detectPricingSplitAnomaly({ labour, materials: total - labour, total });
    expect(findings.some((f) => f.reason === "VERY_LOW_LABOUR")).toBe(false);
  });
});

describe("Module 65 — detectExtremeQuoteModification", () => {
  it("flags a modification beyond the threshold", () => {
    const finding = detectExtremeQuoteModification(1000, 1000 * (1 + EXTREME_QUOTE_MODIFICATION_RATIO + 0.1));
    expect(finding?.reason).toBe("EXTREME_QUOTE_MODIFICATION");
  });

  it("does not flag a modest revision", () => {
    expect(detectExtremeQuoteModification(1000, 1050)).toBeNull();
  });

  it("returns null when the previous total is zero or negative", () => {
    expect(detectExtremeQuoteModification(0, 500)).toBeNull();
  });
});

describe("Module 65 — detectRepeatedPricingAnomalies", () => {
  it("returns null below the threshold", () => {
    expect(detectRepeatedPricingAnomalies("pro-1", 1)).toBeNull();
  });

  it("flags at the threshold", () => {
    expect(detectRepeatedPricingAnomalies("pro-1", 3)?.reason).toBe("REPEATED_PRICING_ANOMALIES");
  });
});
