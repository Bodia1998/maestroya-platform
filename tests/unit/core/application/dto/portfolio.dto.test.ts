import { describe, expect, it } from "vitest";

import {
  createPortfolioItemSchema,
  listPortfolioItemsSchema,
  updatePortfolioItemSchema,
} from "@/application/dto/portfolio.dto";

const validInput = {
  title: "Bathroom remodel",
  description: "Full bathroom renovation including tiling and plumbing.",
  mediaUrl: "https://res.cloudinary.com/demo/image/upload/v1/bathroom.jpg",
};

describe("createPortfolioItemSchema", () => {
  it("accepts a full valid submission", () => {
    const result = createPortfolioItemSchema.safeParse({
      ...validInput,
      serviceCategoryId: "123e4567-e89b-12d3-a456-426614174000",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a submission without description/serviceCategoryId (both optional)", () => {
    const result = createPortfolioItemSchema.safeParse({ title: validInput.title, mediaUrl: validInput.mediaUrl });
    expect(result.success).toBe(true);
  });

  it("rejects a missing title", () => {
    const result = createPortfolioItemSchema.safeParse({ mediaUrl: validInput.mediaUrl });
    expect(result.success).toBe(false);
  });

  it("rejects a title shorter than 3 characters", () => {
    const result = createPortfolioItemSchema.safeParse({ ...validInput, title: "ab" });
    expect(result.success).toBe(false);
  });

  it("rejects a title longer than 120 characters", () => {
    const result = createPortfolioItemSchema.safeParse({ ...validInput, title: "a".repeat(121) });
    expect(result.success).toBe(false);
  });

  it("rejects a description longer than 2000 characters", () => {
    const result = createPortfolioItemSchema.safeParse({ ...validInput, description: "a".repeat(2001) });
    expect(result.success).toBe(false);
  });

  it("rejects a missing media URL", () => {
    const result = createPortfolioItemSchema.safeParse({ title: validInput.title });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed media URL", () => {
    const result = createPortfolioItemSchema.safeParse({ ...validInput, mediaUrl: "not-a-url" });
    expect(result.success).toBe(false);
  });

  it("rejects a non-UUID service category id", () => {
    const result = createPortfolioItemSchema.safeParse({ ...validInput, serviceCategoryId: "not-a-uuid" });
    expect(result.success).toBe(false);
  });

  it("never accepts a professionalId/professionalProfileId field (ownership is never client input)", () => {
    const parsed = createPortfolioItemSchema.parse({
      ...validInput,
      professionalId: "some-other-id",
    } as never);
    expect(parsed).not.toHaveProperty("professionalId");
  });
});

describe("updatePortfolioItemSchema", () => {
  it("accepts the same shape as create", () => {
    expect(updatePortfolioItemSchema.safeParse(validInput).success).toBe(true);
  });

  it("rejects an invalid title the same way create does", () => {
    expect(updatePortfolioItemSchema.safeParse({ ...validInput, title: "" }).success).toBe(false);
  });
});

describe("listPortfolioItemsSchema", () => {
  it("accepts a valid professionalProfileId with defaults", () => {
    const result = listPortfolioItemsSchema.safeParse({
      professionalProfileId: "123e4567-e89b-12d3-a456-426614174000",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(20);
      expect(result.data.offset).toBe(0);
    }
  });

  it("rejects a non-UUID professionalProfileId", () => {
    const result = listPortfolioItemsSchema.safeParse({ professionalProfileId: "not-a-uuid" });
    expect(result.success).toBe(false);
  });

  it("rejects a limit above 100", () => {
    const result = listPortfolioItemsSchema.safeParse({
      professionalProfileId: "123e4567-e89b-12d3-a456-426614174000",
      limit: 101,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a negative offset", () => {
    const result = listPortfolioItemsSchema.safeParse({
      professionalProfileId: "123e4567-e89b-12d3-a456-426614174000",
      offset: -1,
    });
    expect(result.success).toBe(false);
  });
});
