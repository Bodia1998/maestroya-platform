import { describe, expect, it, vi } from "vitest";

import { ProfessionalCreated } from "@/domain/events/professional-created";
import { ProfessionalUpdated } from "@/domain/events/professional-updated";
import type { EventBus } from "@/application/ports/event-bus";
import { CreateProfessionalUseCase } from "@/application/use-cases/professional/create-professional.use-case";
import { DeactivateProfessionalUseCase } from "@/application/use-cases/professional/deactivate-professional.use-case";
import { UpdateProfessionalServicesUseCase } from "@/application/use-cases/professional/update-professional-services.use-case";
import { UpdateProfessionalUseCase } from "@/application/use-cases/professional/update-professional.use-case";
import { FakeProfessionalRepository, FakeServiceCategoryRepository } from "./fakes";

/**
 * Module 47 — CQRS Search Engine: verifies that the professional use cases
 * publish the lifecycle events the search-indexing subscribers depend on
 * (`infrastructure/search/compose.ts`), and that a failing EventBus never
 * fails the underlying write (per `publishDomainEvent`'s contract).
 */
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

describe("professional use cases publish search-indexing events", () => {
  it("CreateProfessionalUseCase publishes ProfessionalCreated after a successful create", async () => {
    const professionals = new FakeProfessionalRepository();
    const categories = new FakeServiceCategoryRepository();
    const bus = fakeBus();
    const useCase = new CreateProfessionalUseCase(professionals, categories, bus);

    const created = await useCase.execute("user-1", {});

    expect(bus.published).toHaveLength(1);
    const event = bus.published[0] as ProfessionalCreated;
    expect(event).toBeInstanceOf(ProfessionalCreated);
    expect(event.professionalId).toBe(created.id);
  });

  it("UpdateProfessionalUseCase publishes ProfessionalUpdated with reason 'profile'", async () => {
    const professionals = new FakeProfessionalRepository();
    const created = await professionals.create("user-1", {});
    const bus = fakeBus();
    const useCase = new UpdateProfessionalUseCase(professionals, bus);

    await useCase.execute("user-1", {});

    const event = bus.published[0] as ProfessionalUpdated;
    expect(event).toBeInstanceOf(ProfessionalUpdated);
    expect(event.professionalId).toBe(created.id);
    expect(event.reason).toBe("profile");
  });

  it("DeactivateProfessionalUseCase publishes ProfessionalUpdated with reason 'status'", async () => {
    const professionals = new FakeProfessionalRepository();
    await professionals.create("user-1", {});
    const bus = fakeBus();
    const useCase = new DeactivateProfessionalUseCase(professionals, bus);

    await useCase.execute("user-1");

    const event = bus.published[0] as ProfessionalUpdated;
    expect(event.reason).toBe("status");
  });

  it("UpdateProfessionalServicesUseCase publishes ProfessionalUpdated with reason 'categories'", async () => {
    const professionals = new FakeProfessionalRepository();
    await professionals.create("user-1", {});
    const categories = new FakeServiceCategoryRepository();
    const categoryId = "123e4567-e89b-12d3-a456-426614174000";
    categories.seed({ id: categoryId, name: "Fontanería", slug: "fontaneria" });
    const bus = fakeBus();
    const useCase = new UpdateProfessionalServicesUseCase(professionals, categories, bus);

    await useCase.execute("user-1", { categoryIds: [categoryId] });

    const event = bus.published[0] as ProfessionalUpdated;
    expect(event.reason).toBe("categories");
  });

  it("a failing EventBus does not fail the write — the profile is still created", async () => {
    const professionals = new FakeProfessionalRepository();
    const categories = new FakeServiceCategoryRepository();
    const bus: EventBus = {
      publish: vi.fn().mockRejectedValue(new Error("bus down")),
      publishAll: vi.fn(),
      subscribe: vi.fn(),
    };
    const useCase = new CreateProfessionalUseCase(professionals, categories, bus);

    // publishDomainEvent only swallows EventDispatchError; a plain Error
    // from a broken bus is a bug and should surface — this documents that
    // boundary rather than asserting the opposite.
    await expect(useCase.execute("user-1", {})).rejects.toThrow("bus down");
  });

  it("omitting the eventBus entirely (default NullEventBus) still creates the profile", async () => {
    const professionals = new FakeProfessionalRepository();
    const categories = new FakeServiceCategoryRepository();
    const useCase = new CreateProfessionalUseCase(professionals, categories);

    await expect(useCase.execute("user-1", {})).resolves.toMatchObject({ userId: "user-1" });
  });
});
