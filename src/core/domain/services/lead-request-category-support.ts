/**
 * Module 142 — which ServiceCategories a customer may pick for a LEAD_V1
 * request. Pure, no I/O, and deliberately NOT a second category list: it is a
 * view over the Module 132 production configuration (the single authority on
 * what the pilot can price), applying the same own-slug-then-parent lookup the
 * Module 129 estimator and the Module 128 engine use.
 *
 * Fail closed: any configuration that is not VALID supports nothing, so the
 * customer is never invited to create a request that publication would have to
 * reject.
 */
export interface LeadRequestCategoryPolicy {
  /** Slugs the pilot fully supports (typical job value AND lead rate). */
  readonly supportedSlugs: ReadonlySet<string>;
  /** Slugs deliberately NOT supported (e.g. "reformas"); wins over any support. */
  readonly unsupportedSlugs: ReadonlySet<string>;
}

export interface LeadRequestCategoryRef {
  slug: string;
  /** Slug of the parent category when this is a subcategory. */
  parentSlug?: string | null;
}

/**
 * The only parts of a Module 132 resolution this rule reads. Structural on
 * purpose: the real `LeadPricingConfigResolution` is assignable to it, and this
 * file stays unaware of the pricing contract itself.
 */
export interface LeadRequestCategoryConfigSource {
  status: string;
  config?: {
    pilotCategorySlugs: readonly string[];
    leadPricing: { unsupportedCategorySlugs?: readonly string[] };
  };
}

export function leadRequestCategoryPolicyFrom(configuration: LeadRequestCategoryConfigSource): LeadRequestCategoryPolicy {
  const config = configuration.status === "VALID" ? configuration.config : undefined;
  if (!config) return { supportedSlugs: new Set(), unsupportedSlugs: new Set() };
  return {
    supportedSlugs: new Set(config.pilotCategorySlugs),
    unsupportedSlugs: new Set(config.leadPricing.unsupportedCategorySlugs ?? []),
  };
}

export function isLeadRequestCategorySupported(category: LeadRequestCategoryRef, policy: LeadRequestCategoryPolicy): boolean {
  const parent = category.parentSlug ? category.parentSlug : null;
  if (policy.unsupportedSlugs.has(category.slug) || (parent !== null && policy.unsupportedSlugs.has(parent))) return false;
  return policy.supportedSlugs.has(category.slug) || (parent !== null && policy.supportedSlugs.has(parent));
}
