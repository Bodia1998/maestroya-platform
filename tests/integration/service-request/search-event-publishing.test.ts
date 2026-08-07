import { describe, expect, it, vi } from "vitest";

import { ServiceRequestUpdated } from "@/domain/events/service-request-updated";
import type { EventBus } from "@/application/ports/event-bus";
import { UpdateServiceRequestUseCase } from "@/application/use-cases/service-request/update-service-request.use-case";
import {
  FakeCustomerProfileRepository,
  FakeGeocodingProvider,
  FakeServiceCategoryRepository,
  FakeServiceRequestRepository,
  VALID_LOCATION,
} from "./fakes";

/** Module 47 — CQRS Search Engine: see tests/integration/professional/search-event-publishing.test.ts. */
function fakeBus(): EventBus & { published: unknown[] } {
  const published: unknown[] = [];
  return {
    published,
    publish: vi.fn(async (event) => {
      published.push(event);
    }),
    publishAll: vi.fn(),
    subscribe: vi.fn(),
  };
}

describe("UpdateServiceRequestUseCase publishes search-indexing events", () => {
  it("publishes ServiceRequestUpdated carrying the request's post-update status", async () => {
    const categories = new FakeServiceCategoryRepository();
    const categoryId = "123e4567-e89b-12d3-a456-426614174000";
    categories.seed({ id: categoryId, name: "Fontanería", slug: "fontaneria" });
    const serviceRequests = new FakeServiceRequestRepository(categories);
    const customerProfiles = new FakeCustomerProfileRepository();
    const customer = await customerProfiles.findOrCreateByUserId("user-1");
    const request = await serviceRequests.create(customer.id, "user-1", {
      categoryId,
      title: "Fuga de agua",
      description: "Fuga bajo el fregadero",
      urgency: "HIGH",
      budgetMin: null,
      budgetMax: null,
      location: { ...VALID_LOCATION, line2: null, province: null, latitude: null, longitude: null },
    });

    const bus = fakeBus();
    const geocoding = new FakeGeocodingProvider();
    const useCase = new UpdateServiceRequestUseCase(serviceRequests, customerProfiles, categories, geocoding, bus);

    const updated = await useCase.execute("user-1", request.id, { title: "Fuga urgente" });

    expect(bus.published).toHaveLength(1);
    const event = bus.published[0] as ServiceRequestUpdated;
    expect(event).toBeInstanceOf(ServiceRequestUpdated);
    expect(event.serviceRequestId).toBe(updated.id);
    expect(event.status).toBe("PUBLISHED");
  });

  it("omitting the eventBus entirely (default NullEventBus) still updates the request", async () => {
    const categories = new FakeServiceCategoryRepository();
    const categoryId = "123e4567-e89b-12d3-a456-426614174000";
    categories.seed({ id: categoryId, name: "Fontanería", slug: "fontaneria" });
    const serviceRequests = new FakeServiceRequestRepository(categories);
    const customerProfiles = new FakeCustomerProfileRepository();
    const customer = await customerProfiles.findOrCreateByUserId("user-1");
    const request = await serviceRequests.create(customer.id, "user-1", {
      categoryId,
      title: "Fuga de agua",
      description: "Fuga bajo el fregadero",
      urgency: "HIGH",
      budgetMin: null,
      budgetMax: null,
      location: { ...VALID_LOCATION, line2: null, province: null, latitude: null, longitude: null },
    });
    const geocoding = new FakeGeocodingProvider();
    const useCase = new UpdateServiceRequestUseCase(serviceRequests, customerProfiles, categories, geocoding);

    await expect(useCase.execute("user-1", request.id, { title: "Fuga urgente" })).resolves.toMatchObject({
      title: "Fuga urgente",
    });
  });
});
