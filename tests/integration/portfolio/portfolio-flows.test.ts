import { describe, expect, it } from "vitest";

import { CreatePortfolioItemUseCase } from "@/application/use-cases/portfolio/create-portfolio-item.use-case";
import { DeletePortfolioItemUseCase } from "@/application/use-cases/portfolio/delete-portfolio-item.use-case";
import { GetPortfolioItemForOwnerUseCase } from "@/application/use-cases/portfolio/get-portfolio-item-for-owner.use-case";
import { ListPortfolioItemsUseCase } from "@/application/use-cases/portfolio/list-portfolio-items.use-case";
import { UpdatePortfolioItemUseCase } from "@/application/use-cases/portfolio/update-portfolio-item.use-case";
import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import { FakePortfolioRepository, FakeProfessionalRepository, FakeServiceCategoryRepository } from "./fakes";

/**
 * Integration tests for the Portfolio module (Module 14). Real use cases +
 * domain services, fake repositories swapped in for storage — same
 * pattern as review-flows.test.ts / job-flows.test.ts.
 */

function makeUseCases() {
  const professionals = new FakeProfessionalRepository();
  const categories = new FakeServiceCategoryRepository();
  const portfolioItems = new FakePortfolioRepository();

  return {
    professionals,
    categories,
    portfolioItems,
    create: new CreatePortfolioItemUseCase(portfolioItems, professionals, categories),
    update: new UpdatePortfolioItemUseCase(portfolioItems, professionals, categories),
    del: new DeletePortfolioItemUseCase(portfolioItems, professionals),
    getForOwner: new GetPortfolioItemForOwnerUseCase(portfolioItems, professionals),
    list: new ListPortfolioItemsUseCase(portfolioItems),
  };
}

const validInput = {
  title: "Bathroom remodel",
  description: "Full bathroom renovation including tiling and plumbing.",
  mediaUrl: "https://res.cloudinary.com/demo/image/upload/v1/bathroom.jpg",
  serviceCategoryId: null as string | null,
};

describe("Portfolio module (Module 14)", () => {
  describe("CreatePortfolioItemUseCase", () => {
    it("lets an authenticated, active professional create a portfolio item", async () => {
      const { create, professionals } = makeUseCases();
      const professional = professionals.seed({ userId: "user-pro-1", status: "ACTIVE" });

      const item = await create.execute("user-pro-1", validInput);

      expect(item.professionalProfileId).toBe(professional.id);
      expect(item.title).toBe("Bathroom remodel");
      expect(item.mediaUrl).toBe(validInput.mediaUrl);
    });

    it("rejects a user with no professional profile (customer/non-professional)", async () => {
      const { create } = makeUseCases();

      await expect(create.execute("user-customer-1", validInput)).rejects.toBeInstanceOf(ValidationError);
    });

    it("rejects an inactive/suspended professional", async () => {
      const { create, professionals } = makeUseCases();
      professionals.seed({ userId: "user-pro-2", status: "SUSPENDED" });

      await expect(create.execute("user-pro-2", validInput)).rejects.toBeInstanceOf(ValidationError);
    });

    it("always associates the item with the authenticated professional, never a client-supplied id", async () => {
      const { create, professionals } = makeUseCases();
      const owner = professionals.seed({ userId: "user-pro-3", status: "ACTIVE" });
      professionals.seed({ userId: "user-pro-4", status: "ACTIVE" });

      // CreatePortfolioItemInput has no professionalId field at all — the
      // only way to influence ownership is which userId calls execute().
      const item = await create.execute("user-pro-3", validInput);

      expect(item.professionalProfileId).toBe(owner.id);
    });

    it("rejects a title shorter than the minimum length", async () => {
      const { create, professionals } = makeUseCases();
      professionals.seed({ userId: "user-pro-5", status: "ACTIVE" });

      await expect(create.execute("user-pro-5", { ...validInput, title: "ab" })).rejects.toBeInstanceOf(
        ValidationError,
      );
    });

    it("rejects a title longer than the maximum length", async () => {
      const { create, professionals } = makeUseCases();
      professionals.seed({ userId: "user-pro-6", status: "ACTIVE" });

      await expect(
        create.execute("user-pro-6", { ...validInput, title: "a".repeat(121) }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("rejects a description longer than the maximum length", async () => {
      const { create, professionals } = makeUseCases();
      professionals.seed({ userId: "user-pro-7", status: "ACTIVE" });

      await expect(
        create.execute("user-pro-7", { ...validInput, description: "a".repeat(2001) }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("rejects a malformed media URL", async () => {
      const { create, professionals } = makeUseCases();
      professionals.seed({ userId: "user-pro-8", status: "ACTIVE" });

      await expect(
        create.execute("user-pro-8", { ...validInput, mediaUrl: "not-a-url" }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("rejects an unsafe media URL scheme", async () => {
      const { create, professionals } = makeUseCases();
      professionals.seed({ userId: "user-pro-9", status: "ACTIVE" });

      await expect(
        create.execute("user-pro-9", { ...validInput, mediaUrl: "javascript:alert(1)" }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("rejects an invalid/inactive service category id", async () => {
      const { create, professionals } = makeUseCases();
      professionals.seed({ userId: "user-pro-10", status: "ACTIVE" });

      await expect(
        create.execute("user-pro-10", { ...validInput, serviceCategoryId: "not-in-catalog" }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("accepts a valid, active service category id", async () => {
      const { create, professionals, categories } = makeUseCases();
      professionals.seed({ userId: "user-pro-11", status: "ACTIVE" });
      categories.seed({ id: "cat-1", name: "Plumbing", slug: "plumbing" });

      const item = await create.execute("user-pro-11", { ...validInput, serviceCategoryId: "cat-1" });

      expect(item.serviceCategoryId).toBe("cat-1");
    });
  });

  describe("UpdatePortfolioItemUseCase", () => {
    it("lets the owner update their own portfolio item", async () => {
      const { create, update, professionals } = makeUseCases();
      professionals.seed({ userId: "user-pro-20", status: "ACTIVE" });
      const item = await create.execute("user-pro-20", validInput);

      const updated = await update.execute("user-pro-20", item.id, {
        ...validInput,
        title: "Updated title",
      });

      expect(updated.title).toBe("Updated title");
      expect(updated.professionalProfileId).toBe(item.professionalProfileId);
    });

    it("preserves ownership — professionalProfileId is not accepted as an update field", async () => {
      const { create, update, professionals } = makeUseCases();
      professionals.seed({ userId: "user-pro-21", status: "ACTIVE" });
      const item = await create.execute("user-pro-21", validInput);

      const updated = await update.execute("user-pro-21", item.id, validInput);

      expect(updated.professionalProfileId).toBe(item.professionalProfileId);
    });

    it("rejects updates from a professional who does not own the item (NotFoundError, not a distinguishable Forbidden)", async () => {
      const { create, update, professionals } = makeUseCases();
      professionals.seed({ userId: "user-pro-22", status: "ACTIVE" });
      professionals.seed({ userId: "user-pro-23", status: "ACTIVE" });
      const item = await create.execute("user-pro-22", validInput);

      await expect(update.execute("user-pro-23", item.id, validInput)).rejects.toBeInstanceOf(NotFoundError);
    });

    it("rejects updates from an unauthenticated/non-professional caller", async () => {
      const { create, update, professionals } = makeUseCases();
      professionals.seed({ userId: "user-pro-24", status: "ACTIVE" });
      const item = await create.execute("user-pro-24", validInput);

      await expect(update.execute("user-customer-2", item.id, validInput)).rejects.toBeInstanceOf(NotFoundError);
    });

    it("returns NotFoundError for a nonexistent item", async () => {
      const { update, professionals } = makeUseCases();
      professionals.seed({ userId: "user-pro-25", status: "ACTIVE" });

      await expect(update.execute("user-pro-25", "does-not-exist", validInput)).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it("rejects an invalid update (validation failure)", async () => {
      const { create, update, professionals } = makeUseCases();
      professionals.seed({ userId: "user-pro-26", status: "ACTIVE" });
      const item = await create.execute("user-pro-26", validInput);

      await expect(update.execute("user-pro-26", item.id, { ...validInput, title: "" })).rejects.toBeInstanceOf(
        ValidationError,
      );
    });
  });

  describe("DeletePortfolioItemUseCase", () => {
    it("lets the owner delete their own portfolio item", async () => {
      const { create, del, list, professionals } = makeUseCases();
      const professional = professionals.seed({ userId: "user-pro-30", status: "ACTIVE" });
      const item = await create.execute("user-pro-30", validInput);

      await del.execute("user-pro-30", item.id);

      const remaining = await list.execute(professional.id, { limit: 20, offset: 0 });
      expect(remaining).toHaveLength(0);
    });

    it("rejects deletion from a professional who does not own the item", async () => {
      const { create, del, professionals } = makeUseCases();
      professionals.seed({ userId: "user-pro-31", status: "ACTIVE" });
      professionals.seed({ userId: "user-pro-32", status: "ACTIVE" });
      const item = await create.execute("user-pro-31", validInput);

      await expect(del.execute("user-pro-32", item.id)).rejects.toBeInstanceOf(NotFoundError);
    });

    it("returns NotFoundError deleting an item that does not exist", async () => {
      const { del, professionals } = makeUseCases();
      professionals.seed({ userId: "user-pro-33", status: "ACTIVE" });

      await expect(del.execute("user-pro-33", "does-not-exist")).rejects.toBeInstanceOf(NotFoundError);
    });

    it("a deleted item is no longer reachable by id (owner get / update / delete all NotFound)", async () => {
      const { create, del, getForOwner, update, professionals } = makeUseCases();
      professionals.seed({ userId: "user-pro-34", status: "ACTIVE" });
      const item = await create.execute("user-pro-34", validInput);
      await del.execute("user-pro-34", item.id);

      await expect(getForOwner.execute("user-pro-34", item.id)).rejects.toBeInstanceOf(NotFoundError);
      await expect(update.execute("user-pro-34", item.id, validInput)).rejects.toBeInstanceOf(NotFoundError);
      await expect(del.execute("user-pro-34", item.id)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("GetPortfolioItemForOwnerUseCase", () => {
    it("lets the owner fetch their own item", async () => {
      const { create, getForOwner, professionals } = makeUseCases();
      professionals.seed({ userId: "user-pro-40", status: "ACTIVE" });
      const item = await create.execute("user-pro-40", validInput);

      const fetched = await getForOwner.execute("user-pro-40", item.id);

      expect(fetched.id).toBe(item.id);
    });

    it("rejects a non-owner professional with NotFoundError", async () => {
      const { create, getForOwner, professionals } = makeUseCases();
      professionals.seed({ userId: "user-pro-41", status: "ACTIVE" });
      professionals.seed({ userId: "user-pro-42", status: "ACTIVE" });
      const item = await create.execute("user-pro-41", validInput);

      await expect(getForOwner.execute("user-pro-42", item.id)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("ListPortfolioItemsUseCase", () => {
    it("lists only the selected professional's portfolio, newest first", async () => {
      const { create, list, professionals } = makeUseCases();
      const proA = professionals.seed({ userId: "user-pro-50", status: "ACTIVE" });
      const proB = professionals.seed({ userId: "user-pro-51", status: "ACTIVE" });

      const first = await create.execute("user-pro-50", { ...validInput, title: "First" });
      await new Promise((resolve) => setTimeout(resolve, 2));
      const second = await create.execute("user-pro-50", { ...validInput, title: "Second" });
      await create.execute("user-pro-51", { ...validInput, title: "Other pro's item" });

      const listA = await list.execute(proA.id, { limit: 20, offset: 0 });
      const listB = await list.execute(proB.id, { limit: 20, offset: 0 });

      expect(listA.map((i) => i.id)).toEqual([second.id, first.id]);
      expect(listB).toHaveLength(1);
    });

    it("isolates portfolios between professionals — one professional's items never appear in another's listing", async () => {
      const { create, list, professionals } = makeUseCases();
      const proA = professionals.seed({ userId: "user-pro-60", status: "ACTIVE" });
      professionals.seed({ userId: "user-pro-61", status: "ACTIVE" });
      await create.execute("user-pro-60", validInput);
      await create.execute("user-pro-61", validInput);
      await create.execute("user-pro-61", validInput);

      const listA = await list.execute(proA.id, { limit: 20, offset: 0 });

      expect(listA).toHaveLength(1);
      expect(listA.every((i) => i.professionalProfileId === proA.id)).toBe(true);
    });

    it("returns an empty list for a professional with no portfolio items", async () => {
      const { list } = makeUseCases();

      const result = await list.execute("no-such-professional", { limit: 20, offset: 0 });

      expect(result).toEqual([]);
    });
  });
});
