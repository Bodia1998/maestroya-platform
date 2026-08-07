import { describe, expect, it } from "vitest";

import type { ServiceRequestRecord, ServiceRequestRepository } from "@/domain/repositories/service-request-repository";
import { SearchDocumentProjector } from "@/application/services/search/search-document-projector";
import {
  FakeSearchableCompanyDiscoveryRepository,
  FakeSearchableProfessionalDiscoveryRepository,
} from "../../../../../integration/search/fakes";

const NOW = new Date("2026-01-01T00:00:00.000Z");

class FakeServiceRequestRepository implements ServiceRequestRepository {
  requests = new Map<string, ServiceRequestRecord>();

  seed(request: ServiceRequestRecord) {
    this.requests.set(request.id, request);
    return request;
  }

  async findById(id: string) {
    return this.requests.get(id) ?? null;
  }
  async findManyByCustomerId() {
    return [];
  }
  async create(): Promise<ServiceRequestRecord> {
    throw new Error("not used");
  }
  async update(): Promise<ServiceRequestRecord> {
    throw new Error("not used");
  }
  async updateStatus() {}
  async addPhoto(): Promise<never> {
    throw new Error("not used");
  }
  async removePhoto() {}
  async countPhotos() {
    return 0;
  }
  async findExpirable() {
    return [];
  }
}

function baseRequest(overrides: Partial<ServiceRequestRecord> = {}): ServiceRequestRecord {
  return {
    id: "request-1",
    customerId: "customer-1",
    categoryId: "cat-1",
    categoryName: "Fontanería",
    title: "Fuga de agua",
    description: "Fuga bajo el fregadero",
    status: "PUBLISHED",
    urgency: "HIGH",
    budgetMin: null,
    budgetMax: null,
    location: {
      line1: "Calle 1",
      line2: null,
      city: "Gandia",
      province: "Valencia",
      postalCode: "46700",
      country: "ES",
      latitude: 38.9,
      longitude: -0.18,
    },
    photos: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeProjector() {
  const professionals = new FakeSearchableProfessionalDiscoveryRepository();
  const companies = new FakeSearchableCompanyDiscoveryRepository();
  const serviceRequests = new FakeServiceRequestRepository();
  const projector = new SearchDocumentProjector({ professionals, companies, serviceRequests }, () => NOW);
  return { professionals, companies, serviceRequests, projector };
}

describe("application/services/search/search-document-projector", () => {
  it("projects an ACTIVE professional into a document", async () => {
    const { professionals, projector } = makeProjector();
    professionals.seed({
      id: "prof-1",
      status: "ACTIVE",
      displayName: "Ana",
      businessName: null,
      headline: null,
      yearsExperience: null,
      hourlyRate: null,
      serviceRadiusKm: null,
      verificationStatus: "VERIFIED",
      profileImageUrl: null,
      categoryIds: [],
      latitude: null,
      longitude: null,
      city: null,
      province: null,
      averageRating: null,
      reviewCount: 0,
      portfolioItemCount: 0,
      createdAt: NOW,
    });

    const doc = await projector.project("PROFESSIONAL", "prof-1");
    expect(doc?.id).toBe("professional:prof-1");
    expect(doc?.indexedAt).toBe(NOW.toISOString());
  });

  it("returns null for a professional that is not ACTIVE (or does not exist)", async () => {
    const { professionals, projector } = makeProjector();
    professionals.seed({
      id: "prof-2",
      status: "INACTIVE",
      displayName: "Ana",
      businessName: null,
      headline: null,
      yearsExperience: null,
      hourlyRate: null,
      serviceRadiusKm: null,
      verificationStatus: "VERIFIED",
      profileImageUrl: null,
      categoryIds: [],
      latitude: null,
      longitude: null,
      city: null,
      province: null,
      averageRating: null,
      reviewCount: 0,
      portfolioItemCount: 0,
      createdAt: NOW,
    });

    expect(await projector.project("PROFESSIONAL", "prof-2")).toBeNull();
    expect(await projector.project("PROFESSIONAL", "does-not-exist")).toBeNull();
  });

  it("returns null for a company that is not ACTIVE", async () => {
    const { companies, projector } = makeProjector();
    companies.seed({
      id: "company-1",
      status: "SUSPENDED",
      displayName: "Reformas",
      legalName: "Reformas SL",
      description: null,
      logoUrl: null,
      isVerified: false,
      averageRating: null,
      reviewCount: 0,
      categoryIds: [],
      city: null,
      province: null,
      latitude: null,
      longitude: null,
      teamSize: 1,
      portfolioItemCount: 0,
      createdAt: NOW,
    });

    expect(await projector.project("COMPANY", "company-1")).toBeNull();
  });

  it("projects a PUBLISHED/QUOTED service request but not one in a closed state", async () => {
    const { serviceRequests, projector } = makeProjector();
    serviceRequests.seed(baseRequest({ id: "open-1", status: "PUBLISHED" }));
    serviceRequests.seed(baseRequest({ id: "quoted-1", status: "QUOTED" }));
    serviceRequests.seed(baseRequest({ id: "closed-1", status: "COMPLETED" }));

    expect(await projector.project("SERVICE_REQUEST", "open-1")).not.toBeNull();
    expect(await projector.project("SERVICE_REQUEST", "quoted-1")).not.toBeNull();
    expect(await projector.project("SERVICE_REQUEST", "closed-1")).toBeNull();
  });

  it("returns null for a service request that no longer exists", async () => {
    const { projector } = makeProjector();
    expect(await projector.project("SERVICE_REQUEST", "missing")).toBeNull();
  });

  describe("projectMany", () => {
    it("preserves order and splits into documents vs. missingIds", async () => {
      const { professionals, projector } = makeProjector();
      professionals.seed({
        id: "prof-active",
        status: "ACTIVE",
        displayName: "Ana",
        businessName: null,
        headline: null,
        yearsExperience: null,
        hourlyRate: null,
        serviceRadiusKm: null,
        verificationStatus: "VERIFIED",
        profileImageUrl: null,
        categoryIds: [],
        latitude: null,
        longitude: null,
        city: null,
        province: null,
        averageRating: null,
        reviewCount: 0,
        portfolioItemCount: 0,
        createdAt: NOW,
      });

      const { documents, missingIds } = await projector.projectMany("PROFESSIONAL", [
        "prof-active",
        "prof-gone",
      ]);

      expect(documents).toHaveLength(1);
      expect(documents[0]!.entityId).toBe("prof-active");
      expect(missingIds).toEqual(["prof-gone"]);
    });

    it("an empty input returns empty output with no repository calls needed", async () => {
      const { projector } = makeProjector();
      const result = await projector.projectMany("PROFESSIONAL", []);
      expect(result).toEqual({ documents: [], missingIds: [] });
    });
  });
});
