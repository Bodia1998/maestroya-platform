import { describe, expect, it } from "vitest";

import {
  MAX_SERVICE_REQUEST_DESCRIPTION_LENGTH,
  MAX_SERVICE_REQUEST_TITLE_LENGTH,
  createServiceRequestSchema,
  serviceRequestLocationSchema,
  updateServiceRequestSchema,
} from "@/application/dto/service-request.dto";

const VALID_LOCATION = {
  line1: "Calle Mayor 1",
  city: "Gandia",
  postalCode: "46700",
  country: "ES",
};

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    categoryId: "123e4567-e89b-12d3-a456-426614174000",
    title: "Fix leaking kitchen tap",
    description: "The tap under the kitchen sink has been dripping for a week.",
    location: VALID_LOCATION,
    ...overrides,
  };
}

describe("createServiceRequestSchema", () => {
  it("accepts a valid full submission", () => {
    const result = createServiceRequestSchema.safeParse(validPayload());
    expect(result.success).toBe(true);
  });

  it("requires a category id", () => {
    const result = createServiceRequestSchema.safeParse(validPayload({ categoryId: undefined }));
    expect(result.success).toBe(false);
  });

  it("rejects a non-UUID category id", () => {
    const result = createServiceRequestSchema.safeParse(validPayload({ categoryId: "not-a-uuid" }));
    expect(result.success).toBe(false);
  });

  it("requires a non-empty title", () => {
    const result = createServiceRequestSchema.safeParse(validPayload({ title: "" }));
    expect(result.success).toBe(false);
  });

  it(`rejects a title longer than ${MAX_SERVICE_REQUEST_TITLE_LENGTH} characters`, () => {
    const result = createServiceRequestSchema.safeParse(
      validPayload({ title: "a".repeat(MAX_SERVICE_REQUEST_TITLE_LENGTH + 1) }),
    );
    expect(result.success).toBe(false);
  });

  it(`accepts a title of exactly ${MAX_SERVICE_REQUEST_TITLE_LENGTH} characters`, () => {
    const result = createServiceRequestSchema.safeParse(
      validPayload({ title: "a".repeat(MAX_SERVICE_REQUEST_TITLE_LENGTH) }),
    );
    expect(result.success).toBe(true);
  });

  it("requires a non-empty description", () => {
    const result = createServiceRequestSchema.safeParse(validPayload({ description: "" }));
    expect(result.success).toBe(false);
  });

  it(`rejects a description longer than ${MAX_SERVICE_REQUEST_DESCRIPTION_LENGTH} characters`, () => {
    const result = createServiceRequestSchema.safeParse(
      validPayload({ description: "a".repeat(MAX_SERVICE_REQUEST_DESCRIPTION_LENGTH + 1) }),
    );
    expect(result.success).toBe(false);
  });

  it("requires a location", () => {
    const result = createServiceRequestSchema.safeParse(validPayload({ location: undefined }));
    expect(result.success).toBe(false);
  });

  it("rejects budgetMin greater than budgetMax", () => {
    const result = createServiceRequestSchema.safeParse(
      validPayload({ budgetMin: 200, budgetMax: 100 }),
    );
    expect(result.success).toBe(false);
  });

  it("accepts budgetMin less than or equal to budgetMax", () => {
    const result = createServiceRequestSchema.safeParse(
      validPayload({ budgetMin: 100, budgetMax: 200 }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects a negative budget", () => {
    const result = createServiceRequestSchema.safeParse(validPayload({ budgetMin: -10 }));
    expect(result.success).toBe(false);
  });

  it("accepts a valid urgency value", () => {
    const result = createServiceRequestSchema.safeParse(validPayload({ urgency: "HIGH" }));
    expect(result.success).toBe(true);
  });

  it("rejects an invalid urgency value", () => {
    const result = createServiceRequestSchema.safeParse(validPayload({ urgency: "ASAP" }));
    expect(result.success).toBe(false);
  });
});

describe("serviceRequestLocationSchema — latitude/longitude bounds", () => {
  it("accepts latitude/longitude within valid ranges", () => {
    const result = serviceRequestLocationSchema.safeParse({
      ...VALID_LOCATION,
      latitude: 40.4168,
      longitude: -3.7038,
    });
    expect(result.success).toBe(true);
  });

  it("accepts the exact boundary values", () => {
    expect(
      serviceRequestLocationSchema.safeParse({ ...VALID_LOCATION, latitude: 90, longitude: 180 })
        .success,
    ).toBe(true);
    expect(
      serviceRequestLocationSchema.safeParse({ ...VALID_LOCATION, latitude: -90, longitude: -180 })
        .success,
    ).toBe(true);
  });

  it("rejects a latitude outside -90..90", () => {
    expect(
      serviceRequestLocationSchema.safeParse({ ...VALID_LOCATION, latitude: 90.1 }).success,
    ).toBe(false);
    expect(
      serviceRequestLocationSchema.safeParse({ ...VALID_LOCATION, latitude: -90.1 }).success,
    ).toBe(false);
  });

  it("rejects a longitude outside -180..180", () => {
    expect(
      serviceRequestLocationSchema.safeParse({ ...VALID_LOCATION, longitude: 180.1 }).success,
    ).toBe(false);
    expect(
      serviceRequestLocationSchema.safeParse({ ...VALID_LOCATION, longitude: -180.1 }).success,
    ).toBe(false);
  });

  it("requires line1, city, and postalCode", () => {
    expect(serviceRequestLocationSchema.safeParse({ ...VALID_LOCATION, line1: "" }).success).toBe(
      false,
    );
    expect(serviceRequestLocationSchema.safeParse({ ...VALID_LOCATION, city: "" }).success).toBe(
      false,
    );
    expect(
      serviceRequestLocationSchema.safeParse({ ...VALID_LOCATION, postalCode: "" }).success,
    ).toBe(false);
  });
});

describe("updateServiceRequestSchema", () => {
  it("accepts an entirely empty update (every field optional)", () => {
    expect(updateServiceRequestSchema.safeParse({}).success).toBe(true);
  });

  it("accepts updating just the title", () => {
    const result = updateServiceRequestSchema.safeParse({ title: "New title" });
    expect(result.success).toBe(true);
  });

  it("rejects a title longer than the max length", () => {
    const result = updateServiceRequestSchema.safeParse({
      title: "a".repeat(MAX_SERVICE_REQUEST_TITLE_LENGTH + 1),
    });
    expect(result.success).toBe(false);
  });

  it("rejects budgetMin greater than budgetMax when both are supplied", () => {
    const result = updateServiceRequestSchema.safeParse({ budgetMin: 300, budgetMax: 50 });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid category id when supplied", () => {
    const result = updateServiceRequestSchema.safeParse({ categoryId: "not-a-uuid" });
    expect(result.success).toBe(false);
  });
});
