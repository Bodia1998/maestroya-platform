import { describe, expect, it } from "vitest";

import { leadRequestSchema, normalizeFreeText } from "@/application/dto/lead-request.dto";

const valid = {
  categoryId: "123e4567-e89b-42d3-a456-426614174000",
  title: "Fuga en el baño",
  description: "El grifo del lavabo gotea desde hace dos días.",
  location: { line1: "Calle Mayor 1", city: "Madrid", postalCode: "28001", country: "ES" },
};

const issuesFor = (input: unknown) => {
  const r = leadRequestSchema.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => i.path.join("."));
};

describe("leadRequestSchema", () => {
  it("accepts a valid request", () => {
    expect(leadRequestSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a missing or malformed category", () => {
    expect(issuesFor({ ...valid, categoryId: undefined })).toContain("categoryId");
    expect(issuesFor({ ...valid, categoryId: "" })).toContain("categoryId");
    expect(issuesFor({ ...valid, categoryId: "fontaneria" })).toContain("categoryId");
  });

  it("rejects a missing, blank or too short description", () => {
    expect(issuesFor({ ...valid, description: undefined })).toContain("description");
    expect(issuesFor({ ...valid, description: "     " })).toContain("description");
    expect(issuesFor({ ...valid, description: "Fuga" })).toContain("description");
    // whitespace padding must not count towards the minimum
    expect(issuesFor({ ...valid, description: `corto${" ".repeat(40)}` })).toContain("description");
  });

  it("rejects a too long description and accepts the boundary", () => {
    expect(issuesFor({ ...valid, description: "a".repeat(5001) })).toContain("description");
    expect(leadRequestSchema.safeParse({ ...valid, description: "a".repeat(5000) }).success).toBe(true);
    expect(leadRequestSchema.safeParse({ ...valid, description: "a".repeat(20) }).success).toBe(true);
    expect(issuesFor({ ...valid, description: "a".repeat(19) })).toContain("description");
  });

  it("rejects a missing title and missing/blank address parts", () => {
    expect(issuesFor({ ...valid, title: "" })).toContain("title");
    expect(issuesFor({ ...valid, location: undefined })).toContain("location");
    expect(issuesFor({ ...valid, location: { ...valid.location, line1: "  " } })).toContain("location.line1");
    expect(issuesFor({ ...valid, location: { ...valid.location, city: "" } })).toContain("location.city");
    expect(issuesFor({ ...valid, location: { ...valid.location, postalCode: "" } })).toContain("location.postalCode");
  });

  it("normalizes whitespace consistently", () => {
    const parsed = leadRequestSchema.parse({
      ...valid,
      title: "  Fuga \n  en   el baño ",
      description: "  Primera   línea  \r\n\r\n\r\n\r\nSegunda\t línea  ",
      location: { ...valid.location, line1: "  Calle   Mayor  1 ", city: " Madrid " },
    });
    expect(parsed.title).toBe("Fuga en el baño");
    expect(parsed.description).toBe("Primera línea\n\nSegunda línea");
    expect(parsed.location.line1).toBe("Calle Mayor 1");
    expect(parsed.location.city).toBe("Madrid");
    expect(normalizeFreeText(parsed.description)).toBe(parsed.description);
  });

  it("defaults the country and strips every field the browser must not control", () => {
    const parsed = leadRequestSchema.parse({
      ...valid,
      location: { line1: "Calle 1", city: "Madrid", postalCode: "28001", latitude: 1, longitude: 2 },
      flowVersion: "LEGACY_QUOTE_PAYMENT",
      customerId: "victim",
      userId: "victim",
      professionalId: "pro",
      status: "PUBLISHED",
      leadId: "lead",
      budgetMin: 1,
    });
    expect(parsed.location.country).toBe("ES");
    for (const key of ["flowVersion", "customerId", "userId", "professionalId", "status", "leadId", "budgetMin"]) {
      expect(parsed, key).not.toHaveProperty(key);
    }
    expect(parsed.location).not.toHaveProperty("latitude");
    expect(parsed.location).not.toHaveProperty("longitude");
  });
});
