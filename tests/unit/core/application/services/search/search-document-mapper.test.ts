import { describe, expect, it } from "vitest";

import type { ProfessionalDiscoveryCandidate } from "@/domain/repositories/professional-discovery-repository";
import type { CompanyDiscoveryCandidate } from "@/domain/repositories/company-discovery-repository";
import type { ServiceRequestRecord } from "@/domain/repositories/service-request-repository";
import {
  toCompanySearchDocument,
  toProfessionalSearchDocument,
  toServiceRequestSearchDocument,
} from "@/application/services/search/search-document-mapper";

const INDEXED_AT = new Date("2026-01-01T00:00:00.000Z");

function professional(overrides: Partial<ProfessionalDiscoveryCandidate> = {}): ProfessionalDiscoveryCandidate {
  return {
    id: "prof-1",
    displayName: "  Ana   García  ",
    businessName: "Fontanería Ana",
    headline: "Fontanera de confianza",
    yearsExperience: 5,
    hourlyRate: 30,
    serviceRadiusKm: 20,
    verificationStatus: "VERIFIED",
    profileImageUrl: "https://example.com/a.jpg",
    categoryIds: ["cat-1"],
    latitude: 38.9,
    longitude: -0.18,
    city: "Gandia",
    province: "Valencia",
    averageRating: 4.6,
    reviewCount: 12,
    portfolioItemCount: 3,
    createdAt: new Date("2025-06-01T00:00:00.000Z"),
    ...overrides,
  };
}

function company(overrides: Partial<CompanyDiscoveryCandidate> = {}): CompanyDiscoveryCandidate {
  return {
    id: "company-1",
    displayName: "Reformas SL",
    legalName: "Reformas Sociedad Limitada",
    description: "Reformas integrales",
    logoUrl: "https://example.com/logo.png",
    isVerified: true,
    averageRating: 4.2,
    reviewCount: 8,
    categoryIds: ["cat-2"],
    city: "Valencia",
    province: "Valencia",
    latitude: 39.47,
    longitude: -0.38,
    teamSize: 5,
    portfolioItemCount: 10,
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function serviceRequest(overrides: Partial<ServiceRequestRecord> = {}): ServiceRequestRecord {
  return {
    id: "request-1",
    customerId: "customer-1",
    categoryId: "cat-3",
    categoryName: "Electricidad",
    title: "Necesito un electricista",
    description: "Cambiar cuadro eléctrico",
    status: "PUBLISHED",
    urgency: "HIGH",
    budgetMin: 100,
    budgetMax: 300,
    location: {
      line1: "Calle Mayor 1",
      line2: null,
      city: "Gandia",
      province: "Valencia",
      postalCode: "46700",
      country: "ES",
      latitude: 38.9665,
      longitude: -0.1817,
    },
    photos: [],
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("application/services/search/search-document-mapper", () => {
  describe("toProfessionalSearchDocument", () => {
    it("derives a deterministic id and copies over the display/search fields", () => {
      const doc = toProfessionalSearchDocument(professional(), INDEXED_AT);
      expect(doc.id).toBe("professional:prof-1");
      expect(doc.kind).toBe("PROFESSIONAL");
      expect(doc.entityId).toBe("prof-1");
      expect(doc.subtitle).toBe("Fontanería Ana");
      expect(doc.indexedAt).toBe(INDEXED_AT.toISOString());
      expect(doc.createdAt).toBe("2025-06-01T00:00:00.000Z");
    });

    it("joins text fields and collapses whitespace, dropping empty/null parts", () => {
      const doc = toProfessionalSearchDocument(professional({ businessName: null, headline: "  " }), INDEXED_AT);
      expect(doc.text).toBe("Ana García Gandia Valencia");
      expect(doc.text).not.toMatch(/\s{2,}/);
    });

    it("derives isVerified from verificationStatus, true only when VERIFIED", () => {
      expect(toProfessionalSearchDocument(professional({ verificationStatus: "VERIFIED" }), INDEXED_AT).isVerified).toBe(
        true,
      );
      expect(
        toProfessionalSearchDocument(professional({ verificationStatus: "UNVERIFIED" }), INDEXED_AT).isVerified,
      ).toBe(false);
      expect(
        toProfessionalSearchDocument(professional({ verificationStatus: "PENDING" }), INDEXED_AT).isVerified,
      ).toBe(false);
    });

    it("copies categoryIds as a new array (no shared reference with the candidate)", () => {
      const candidate = professional();
      const doc = toProfessionalSearchDocument(candidate, INDEXED_AT);
      expect(doc.categoryIds).toEqual(candidate.categoryIds);
      expect(doc.categoryIds).not.toBe(candidate.categoryIds);
    });
  });

  describe("toCompanySearchDocument", () => {
    it("maps company fields, using legalName as subtitle", () => {
      const doc = toCompanySearchDocument(company(), INDEXED_AT);
      expect(doc.id).toBe("company:company-1");
      expect(doc.kind).toBe("COMPANY");
      expect(doc.subtitle).toBe("Reformas Sociedad Limitada");
      expect(doc.isVerified).toBe(true);
      expect(doc.text).toBe("Reformas SL Reformas Sociedad Limitada Reformas integrales Valencia Valencia");
    });

    it("omits a null description from the text blob", () => {
      const doc = toCompanySearchDocument(company({ description: null }), INDEXED_AT);
      expect(doc.text).not.toMatch(/null/);
    });
  });

  describe("toServiceRequestSearchDocument", () => {
    it("maps location fields and uses the category name as subtitle", () => {
      const doc = toServiceRequestSearchDocument(serviceRequest(), INDEXED_AT);
      expect(doc.id).toBe("service_request:request-1");
      expect(doc.kind).toBe("SERVICE_REQUEST");
      expect(doc.subtitle).toBe("Electricidad");
      expect(doc.city).toBe("Gandia");
      expect(doc.province).toBe("Valencia");
      expect(doc.latitude).toBe(38.9665);
      expect(doc.categoryIds).toEqual(["cat-3"]);
    });

    it("projects neutral rating/verification/portfolio values, never null-crashing on absent signals", () => {
      const doc = toServiceRequestSearchDocument(serviceRequest(), INDEXED_AT);
      expect(doc.isVerified).toBe(false);
      expect(doc.averageRating).toBeNull();
      expect(doc.reviewCount).toBe(0);
      expect(doc.portfolioItemCount).toBe(0);
    });

    it("falls back to null coordinates when the location has none", () => {
      const doc = toServiceRequestSearchDocument(
        serviceRequest({
          location: {
            line1: "Calle X",
            line2: null,
            city: "Madrid",
            province: null,
            postalCode: "28001",
            country: "ES",
            latitude: null,
            longitude: null,
          },
        }),
        INDEXED_AT,
      );
      expect(doc.latitude).toBeNull();
      expect(doc.longitude).toBeNull();
      expect(doc.province).toBeNull();
    });
  });
});
