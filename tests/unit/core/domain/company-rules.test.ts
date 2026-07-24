import { describe, expect, it } from "vitest";

import {
  canTransitionCompanyStatus,
  isCompanyDiscoverable,
  isValidLegalName,
  slugify,
} from "@/domain/services/company-rules";

describe("company-rules (Module 18)", () => {
  describe("canTransitionCompanyStatus", () => {
    it("allows the documented transitions", () => {
      expect(canTransitionCompanyStatus("PENDING", "ACTIVE")).toBe(true);
      expect(canTransitionCompanyStatus("ACTIVE", "SUSPENDED")).toBe(true);
      expect(canTransitionCompanyStatus("SUSPENDED", "ACTIVE")).toBe(true);
      expect(canTransitionCompanyStatus("ACTIVE", "DEACTIVATED")).toBe(true);
      expect(canTransitionCompanyStatus("DEACTIVATED", "ACTIVE")).toBe(true);
    });

    it("rejects invalid company status transitions", () => {
      expect(canTransitionCompanyStatus("DEACTIVATED", "SUSPENDED")).toBe(false);
      expect(canTransitionCompanyStatus("PENDING", "PENDING")).toBe(false);
      expect(canTransitionCompanyStatus("SUSPENDED", "SUSPENDED")).toBe(false);
    });
  });

  describe("isCompanyDiscoverable", () => {
    it("only ACTIVE companies are discoverable", () => {
      expect(isCompanyDiscoverable("ACTIVE")).toBe(true);
      expect(isCompanyDiscoverable("PENDING")).toBe(false);
      expect(isCompanyDiscoverable("SUSPENDED")).toBe(false);
      expect(isCompanyDiscoverable("DEACTIVATED")).toBe(false);
    });
  });

  describe("isValidLegalName", () => {
    it("accepts a reasonable name and rejects too-short/too-long ones", () => {
      expect(isValidLegalName("Acme S.L.")).toBe(true);
      expect(isValidLegalName("A")).toBe(false);
      expect(isValidLegalName("x".repeat(201))).toBe(false);
    });
  });

  describe("slugify", () => {
    it("produces a URL-safe, lowercase, hyphenated slug", () => {
      expect(slugify("Juan & Pedro Plumbing S.L.")).toBe("juan-pedro-plumbing-s-l");
      expect(slugify("  Café Con Leche  ")).toBe("cafe-con-leche");
      expect(slugify("---")).toBe("");
    });
  });
});
