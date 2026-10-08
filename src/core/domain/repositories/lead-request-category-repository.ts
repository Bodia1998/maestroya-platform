export interface LeadRequestCategoryRecord {
  id: string;
  name: string;
  slug: string;
  /** Slug of the parent category, when this is a subcategory. */
  parentSlug: string | null;
}

/**
 * Module 142 — narrow, read-only view of ACTIVE ServiceCategories with the
 * parent slug needed to apply the LEAD_V1 category-support rule. Kept apart
 * from ServiceCategoryRepository so that interface (and its many fakes) is
 * untouched.
 */
export interface LeadRequestCategoryRepository {
  listActive(): Promise<LeadRequestCategoryRecord[]>;
  findActiveById(id: string): Promise<LeadRequestCategoryRecord | null>;
}
