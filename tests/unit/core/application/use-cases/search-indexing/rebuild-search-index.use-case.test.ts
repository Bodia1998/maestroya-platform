import { describe, expect, it, vi } from "vitest";

import { InMemorySearchProvider } from "@/infrastructure/search/providers/in-memory-search-provider";
import { nullSearchObserver, type SearchObserver } from "@/application/ports/search-observer";
import { SearchDocumentProjector } from "@/application/services/search/search-document-projector";
import { BatchIndexSearchDocumentsUseCase } from "@/application/use-cases/search-indexing/batch-index-search-documents.use-case";
import { RebuildSearchIndexUseCase } from "@/application/use-cases/search-indexing/rebuild-search-index.use-case";
import type { ServiceRequestRepository } from "@/domain/repositories/service-request-repository";
import {
  FakeSearchableCompanyDiscoveryRepository,
  FakeSearchableProfessionalDiscoveryRepository,
} from "../../../../../integration/search/fakes";

const NOW = new Date("2026-01-01T00:00:00.000Z");

const noopServiceRequests: ServiceRequestRepository = {
  findById: async () => null,
  findManyByCustomerId: async () => [],
  create: async () => {
    throw new Error("not used");
  },
  update: async () => {
    throw new Error("not used");
  },
  updateStatus: async () => {},
  addPhoto: async () => {
    throw new Error("not used");
  },
  removePhoto: async () => {},
  countPhotos: async () => 0,
  findExpirable: async () => [],
};

function professional(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    status: "ACTIVE" as const,
    displayName: `Pro ${id}`,
    businessName: null,
    headline: null,
    yearsExperience: null,
    hourlyRate: null,
    serviceRadiusKm: null,
    verificationStatus: "VERIFIED" as const,
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
    ...overrides,
  };
}

function makeRebuild(now: () => Date = () => NOW, observer: SearchObserver = nullSearchObserver) {
  const provider = new InMemorySearchProvider();
  const professionals = new FakeSearchableProfessionalDiscoveryRepository();
  const companies = new FakeSearchableCompanyDiscoveryRepository();
  const projector = new SearchDocumentProjector({ professionals, companies, serviceRequests: noopServiceRequests }, now);
  const batchIndex = new BatchIndexSearchDocumentsUseCase(provider, projector, observer);
  const rebuild = new RebuildSearchIndexUseCase(provider, batchIndex, professionals, companies, observer, now);
  return { provider, professionals, companies, rebuild };
}

describe("application/use-cases/search-indexing/rebuild-search-index", () => {
  it("indexes every ACTIVE professional and company", async () => {
    const { provider, professionals, companies, rebuild } = makeRebuild();
    professionals.seed(professional("p1"));
    professionals.seed(professional("p2"));
    companies.seed({
      id: "c1",
      status: "ACTIVE",
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

    const report = await rebuild.execute();

    expect(report.totalIndexed).toBe(3);
    expect(await provider.countDocuments("PROFESSIONAL")).toBe(2);
    expect(await provider.countDocuments("COMPANY")).toBe(1);
  });

  it("only rebuilds PROFESSIONAL and COMPANY, never SERVICE_REQUEST", async () => {
    const { rebuild } = makeRebuild();
    const report = await rebuild.execute();
    expect(report.kinds.map((k) => k.kind).sort()).toEqual(["COMPANY", "PROFESSIONAL"]);
  });

  it("sweeps documents that were indexed before this rebuild started and are no longer eligible", async () => {
    const { provider, professionals, rebuild } = makeRebuild();
    // A document from a previous run, for an entity that is no longer active.
    await provider.indexDocument({
      id: "professional:stale-1",
      kind: "PROFESSIONAL",
      entityId: "stale-1",
      title: "Gone",
      subtitle: null,
      text: "gone",
      categoryIds: [],
      city: null,
      province: null,
      latitude: null,
      longitude: null,
      isVerified: false,
      averageRating: null,
      reviewCount: 0,
      portfolioItemCount: 0,
      createdAt: NOW.toISOString(),
      indexedAt: new Date(NOW.getTime() - 60_000).toISOString(),
    });
    professionals.seed(professional("p1"));

    const report = await rebuild.execute();

    expect(report.totalSweptStale).toBe(1);
    expect(await provider.countDocuments("PROFESSIONAL")).toBe(1);
  });

  it("never leaves the index empty mid-rebuild — writes happen before the stale sweep", async () => {
    const { provider, professionals, rebuild } = makeRebuild();
    professionals.seed(professional("p1"));
    professionals.seed(professional("p2"));

    await rebuild.execute();

    // A second rebuild of the same, unchanged data must be idempotent: same
    // document count, nothing spuriously swept.
    const secondReport = await rebuild.execute();
    expect(secondReport.totalSweptStale).toBe(0);
    expect(await provider.countDocuments("PROFESSIONAL")).toBe(2);
  });

  it("reports rebuild progress per batch and a final onSyncCompleted", async () => {
    const onRebuildProgress = vi.fn();
    const onSyncCompleted = vi.fn();
    const { rebuild, professionals } = makeRebuild(undefined, {
      ...nullSearchObserver,
      onRebuildProgress,
      onSyncCompleted,
    });
    professionals.seed(professional("p1"));

    await rebuild.execute({ batchSize: 1 });

    expect(onRebuildProgress).toHaveBeenCalled();
    expect(onSyncCompleted).toHaveBeenCalledWith(expect.objectContaining({ operation: "rebuild" }));
  });

  it("can be restricted to a subset of kinds", async () => {
    const { provider, professionals, companies, rebuild } = makeRebuild();
    professionals.seed(professional("p1"));
    companies.seed({
      id: "c1",
      status: "ACTIVE",
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

    await rebuild.execute({ kinds: ["PROFESSIONAL"] });

    expect(await provider.countDocuments("PROFESSIONAL")).toBe(1);
    expect(await provider.countDocuments("COMPANY")).toBe(0);
  });
});
