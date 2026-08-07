import { describe, expect, it, vi } from "vitest";

import { CompanyCreated } from "@/domain/events/company-created";
import { CompanyUpdated } from "@/domain/events/company-updated";
import type { EventBus } from "@/application/ports/event-bus";
import { CreateCompanyUseCase } from "@/application/use-cases/company/create-company.use-case";
import { UpdateCompanyServicesUseCase } from "@/application/use-cases/company/update-company-services.use-case";
import { UpdateCompanyUseCase } from "@/application/use-cases/company/update-company.use-case";
import {
  FakeCompanyMembershipRepository,
  FakeCompanyRepository,
  FakeServiceCategoryRepository,
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

describe("company use cases publish search-indexing events", () => {
  it("CreateCompanyUseCase publishes CompanyCreated only after the company AND its owner membership exist", async () => {
    const companies = new FakeCompanyRepository();
    const memberships = new FakeCompanyMembershipRepository();
    const categories = new FakeServiceCategoryRepository();
    const bus = fakeBus();
    const useCase = new CreateCompanyUseCase(companies, memberships, categories, bus);

    const created = await useCase.execute("owner-1", { legalName: "Reformas SL", taxId: "B12345678" });

    expect(bus.published).toHaveLength(1);
    const event = bus.published[0] as CompanyCreated;
    expect(event).toBeInstanceOf(CompanyCreated);
    expect(event.companyId).toBe(created.id);
    expect(await memberships.findOwner(created.id)).not.toBeNull();
  });

  it("UpdateCompanyUseCase publishes CompanyUpdated with reason 'profile'", async () => {
    const companies = new FakeCompanyRepository();
    const memberships = new FakeCompanyMembershipRepository();
    const created = await companies.create("owner-1", { legalName: "Reformas SL", taxId: "B12345678", slug: "reformas-sl" });
    memberships.seed({ companyId: created.id, userId: "owner-1", role: "OWNER" });
    const bus = fakeBus();
    const useCase = new UpdateCompanyUseCase(companies, memberships, bus);

    await useCase.execute("owner-1", created.id, { legalName: "Reformas SL" });

    const event = bus.published[0] as CompanyUpdated;
    expect(event).toBeInstanceOf(CompanyUpdated);
    expect(event.companyId).toBe(created.id);
    expect(event.reason).toBe("profile");
  });

  it("UpdateCompanyServicesUseCase publishes CompanyUpdated with reason 'categories'", async () => {
    const companies = new FakeCompanyRepository();
    const memberships = new FakeCompanyMembershipRepository();
    const created = await companies.create("owner-1", { legalName: "Reformas SL", taxId: "B12345678", slug: "reformas-sl" });
    memberships.seed({ companyId: created.id, userId: "owner-1", role: "OWNER" });
    const categories = new FakeServiceCategoryRepository();
    const categoryId = "123e4567-e89b-12d3-a456-426614174000";
    categories.seed({ id: categoryId, name: "Reformas", slug: "reformas" });
    const bus = fakeBus();
    const useCase = new UpdateCompanyServicesUseCase(companies, memberships, categories, bus);

    await useCase.execute("owner-1", created.id, { categoryIds: [categoryId] });

    const event = bus.published[0] as CompanyUpdated;
    expect(event.reason).toBe("categories");
  });

  it("omitting the eventBus entirely (default NullEventBus) still updates the company", async () => {
    const companies = new FakeCompanyRepository();
    const memberships = new FakeCompanyMembershipRepository();
    const created = await companies.create("owner-1", { legalName: "Reformas SL", taxId: "B12345678", slug: "reformas-sl" });
    memberships.seed({ companyId: created.id, userId: "owner-1", role: "OWNER" });
    const useCase = new UpdateCompanyUseCase(companies, memberships);

    await expect(
      useCase.execute("owner-1", created.id, { legalName: "Reformas SL" }),
    ).resolves.toMatchObject({ id: created.id });
  });
});
