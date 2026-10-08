import { describe, expect, it } from "vitest";

import { resolveLeadPricingProductionConfig } from "@/infrastructure/pricing/lead-pricing-production-config-resolver";
import {
  isLeadRequestCategorySupported,
  leadRequestCategoryPolicyFrom,
} from "@/domain/services/lead-request-category-support";

/** Module 142 — the category rule is a view over the Module 132 configuration, never a second list. */
const pilot = leadRequestCategoryPolicyFrom(resolveLeadPricingProductionConfig("lead-pricing-pilot-v1"));

describe("lead request category support", () => {
  it("supports exactly the M132 pilot categories", () => {
    for (const slug of ["fontaneria", "electricidad", "aire-acondicionado", "pintura", "montaje-de-muebles"]) {
      expect(isLeadRequestCategorySupported({ slug }, pilot), slug).toBe(true);
    }
  });

  it("rejects the explicitly unsupported category and anything unknown", () => {
    expect(isLeadRequestCategorySupported({ slug: "reformas" }, pilot)).toBe(false);
    expect(isLeadRequestCategorySupported({ slug: "jardineria" }, pilot)).toBe(false);
  });

  it("supports a subcategory through its supported parent, like the estimator does", () => {
    expect(isLeadRequestCategorySupported({ slug: "fontanero", parentSlug: "fontaneria" }, pilot)).toBe(true);
    expect(isLeadRequestCategorySupported({ slug: "x", parentSlug: "reformas" }, pilot)).toBe(false);
    expect(isLeadRequestCategorySupported({ slug: "x", parentSlug: "jardineria" }, pilot)).toBe(false);
  });

  it("fails closed when the configuration is not valid", () => {
    for (const selector of [undefined, "", "unknown-version"]) {
      const policy = leadRequestCategoryPolicyFrom(resolveLeadPricingProductionConfig(selector));
      expect(isLeadRequestCategorySupported({ slug: "fontaneria" }, policy)).toBe(false);
    }
  });
});
