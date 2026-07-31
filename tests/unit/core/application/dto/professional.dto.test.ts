import { describe, expect, it } from "vitest";

import {
  createProfessionalSchema,
  deactivateProfessionalSchema,
  professionalOnboardingSchema,
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

  // Regression: hourlyRate is not part of this marketplace's MVP
  // professional pricing model (pricing happens per-Quote) and was
  // removed from the professional-facing flow entirely — see this
  // schema's own doc comment.
  it("strips a client-supplied hourlyRate rather than accepting it", () => {
    const result = createProfessionalSchema.safeParse({ hourlyRate: 45.5 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("hourlyRate");
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

describe("professionalOnboardingSchema", () => {
  const validAddress = {
    line1: "Carrer Major 12",
    city: "Gandia",
    province: "Valencia",
    postalCode: "46700",
    country: "ES",
  };
  const valid = {
    categoryIds: ["123e4567-e89b-12d3-a456-426614174000"],
    contactPhone: "+34600000000",
    bio: "10 years fixing pipes across the Valencia region.",
    serviceRadiusKm: 20,
    address: validAddress,
  };

  it("accepts a complete, valid onboarding submission", () => {
    expect(professionalOnboardingSchema.safeParse(valid).success).toBe(true);
  });

  it("requires at least one category — unlike createProfessionalSchema, categories are not optional here", () => {
    const result = professionalOnboardingSchema.safeParse({ ...valid, categoryIds: [] });
    expect(result.success).toBe(false);
  });

  it("requires a phone number — unlike createProfessionalSchema's optional contactPhone", () => {
    const { contactPhone: _contactPhone, ...withoutPhone } = valid;
    const result = professionalOnboardingSchema.safeParse(withoutPhone);
    expect(result.success).toBe(false);
  });

  it("rejects an invalid phone number", () => {
    const result = professionalOnboardingSchema.safeParse({ ...valid, contactPhone: "abc" });
    expect(result.success).toBe(false);
  });

  it("requires a non-empty description — unlike createProfessionalSchema's optional bio", () => {
    const result = professionalOnboardingSchema.safeParse({ ...valid, bio: "" });
    expect(result.success).toBe(false);
  });

  it("requires a service radius — unlike createProfessionalSchema's optional one", () => {
    const { serviceRadiusKm: _serviceRadiusKm, ...withoutRadius } = valid;
    const result = professionalOnboardingSchema.safeParse(withoutRadius);
    expect(result.success).toBe(false);
  });

  it("rejects an unrealistic service radius", () => {
    const result = professionalOnboardingSchema.safeParse({ ...valid, serviceRadiusKm: 5000 });
    expect(result.success).toBe(false);
  });

  it("requires a base location — reuses the Profile module's own addressSchema, not a free-text service-area field", () => {
    const { address: _address, ...withoutAddress } = valid;
    const result = professionalOnboardingSchema.safeParse(withoutAddress);
    expect(result.success).toBe(false);
  });

  it("rejects an incomplete address (missing city)", () => {
    const { city: _city, ...addressWithoutCity } = validAddress;
    const result = professionalOnboardingSchema.safeParse({
      ...valid,
      address: addressWithoutCity,
    });
    expect(result.success).toBe(false);
  });

  it("does not expose a separate free-text service-area field", () => {
    const result = professionalOnboardingSchema.safeParse({
      ...valid,
      serviceArea: "Downtown and surrounding neighborhoods",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("serviceArea");
    }
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
