import { describe, expect, it } from "vitest";

import {
  createProfessionalSchema,
  deactivateProfessionalSchema,
  updateProfessionalSchema,
  updateProfessionalServicesSchema,
} from "@/application/dto/professional.dto";

describe("createProfessionalSchema", () => {
  it("accepts an entirely empty submission (every field optional)", () => {
    expect(createProfessionalSchema.safeParse({}).success).toBe(true);
  });

  it("accepts a full submission", () => {
    const result = createProfessionalSchema.safeParse({
      businessName: "Ana's Plumbing",
      headline: "Licensed plumber",
      bio: "10 years of experience.",
      yearsExperience: 10,
      hourlyRate: 45.5,
      serviceRadiusKm: 20,
      contactEmail: "ana@example.com",
      contactPhone: "+34600000000",
      websiteUrl: "https://ana-plumbing.example.com",
      taxId: "12345678Z",
      categoryIds: ["123e4567-e89b-12d3-a456-426614174000"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a negative years of experience", () => {
    const result = createProfessionalSchema.safeParse({ yearsExperience: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid contact email", () => {
    const result = createProfessionalSchema.safeParse({ contactEmail: "not-an-email" });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid website URL", () => {
    const result = createProfessionalSchema.safeParse({ websiteUrl: "not a url" });
    expect(result.success).toBe(false);
  });

  it("rejects a non-UUID category id", () => {
    const result = createProfessionalSchema.safeParse({ categoryIds: ["not-a-uuid"] });
    expect(result.success).toBe(false);
  });

  it("does not accept status or verificationStatus fields even if supplied", () => {
    const result = createProfessionalSchema.safeParse({
      status: "SUSPENDED",
      verificationStatus: "VERIFIED",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("status");
      expect(result.data).not.toHaveProperty("verificationStatus");
    }
  });
});

describe("updateProfessionalSchema", () => {
  it("accepts an empty update", () => {
    expect(updateProfessionalSchema.safeParse({}).success).toBe(true);
  });

  it("accepts isAcceptingRequests toggling", () => {
    const result = updateProfessionalSchema.safeParse({ isAcceptingRequests: false });
    expect(result.success).toBe(true);
  });

  it("has no categoryIds field (services are updated via their own schema)", () => {
    const result = updateProfessionalSchema.safeParse({
      categoryIds: ["123e4567-e89b-12d3-a456-426614174000"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("categoryIds");
    }
  });
});

describe("updateProfessionalServicesSchema", () => {
  it("requires at least one category", () => {
    const result = updateProfessionalServicesSchema.safeParse({ categoryIds: [] });
    expect(result.success).toBe(false);
  });

  it("accepts one or more valid category ids", () => {
    const result = updateProfessionalServicesSchema.safeParse({
      categoryIds: ["123e4567-e89b-12d3-a456-426614174000"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a non-UUID category id", () => {
    const result = updateProfessionalServicesSchema.safeParse({ categoryIds: ["nope"] });
    expect(result.success).toBe(false);
  });
});

describe("deactivateProfessionalSchema", () => {
  it("requires the literal confirmation text DEACTIVATE", () => {
    const result = deactivateProfessionalSchema.safeParse({ confirmationText: "deactivate" });
    expect(result.success).toBe(false);
  });

  it("accepts the correct confirmation", () => {
    const result = deactivateProfessionalSchema.safeParse({ confirmationText: "DEACTIVATE" });
    expect(result.success).toBe(true);
  });
});
