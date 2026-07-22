import { describe, expect, it } from "vitest";

import {
  getProfessionalPublicProfileSchema,
  searchProfessionalsSchema,
} from "@/application/dto/discovery.dto";

const VALID_CATEGORY_ID = "123e4567-e89b-12d3-a456-426614174000";

describe("searchProfessionalsSchema", () => {
  it("accepts a valid search", () => {
    const result = searchProfessionalsSchema.safeParse({
      categoryId: VALID_CATEGORY_ID,
      latitude: 38.9665,
      longitude: -0.1817,
    });
    expect(result.success).toBe(true);
  });

  it("defaults page and pageSize when omitted", () => {
    const result = searchProfessionalsSchema.safeParse({
      categoryId: VALID_CATEGORY_ID,
      latitude: 38.9665,
      longitude: -0.1817,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.pageSize).toBe(20);
    }
  });

  it("rejects a non-UUID category id", () => {
    const result = searchProfessionalsSchema.safeParse({
      categoryId: "not-a-uuid",
      latitude: 38.9665,
      longitude: -0.1817,
    });
    expect(result.success).toBe(false);
  });

  it("rejects an out-of-range latitude", () => {
    const result = searchProfessionalsSchema.safeParse({
      categoryId: VALID_CATEGORY_ID,
      latitude: 200,
      longitude: -0.1817,
    });
    expect(result.success).toBe(false);
  });

  it("rejects an out-of-range longitude", () => {
    const result = searchProfessionalsSchema.safeParse({
      categoryId: VALID_CATEGORY_ID,
      latitude: 38.9665,
      longitude: -200,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-numeric latitude/longitude", () => {
    const result = searchProfessionalsSchema.safeParse({
      categoryId: VALID_CATEGORY_ID,
      latitude: "not-a-number",
      longitude: -0.1817,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a pageSize above the allowed maximum", () => {
    const result = searchProfessionalsSchema.safeParse({
      categoryId: VALID_CATEGORY_ID,
      latitude: 38.9665,
      longitude: -0.1817,
      pageSize: 500,
    });
    expect(result.success).toBe(false);
  });

  it("does not accept a status or verificationStatus filter even if supplied", () => {
    const result = searchProfessionalsSchema.safeParse({
      categoryId: VALID_CATEGORY_ID,
      latitude: 38.9665,
      longitude: -0.1817,
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

describe("getProfessionalPublicProfileSchema", () => {
  it("accepts a valid professional id", () => {
    const result = getProfessionalPublicProfileSchema.safeParse({
      professionalId: VALID_CATEGORY_ID,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a non-UUID professional id", () => {
    const result = getProfessionalPublicProfileSchema.safeParse({ professionalId: "nope" });
    expect(result.success).toBe(false);
  });
});
