export interface ServiceCategoryRecord {
  id: string;
  name: string;
  slug: string;
}

/**
 * Narrow read-only interface onto the existing ServiceCategory model,
 * scoped to what the Professional Module needs: listing active categories
 * for the service-category picker, and validating a set of category ids a
 * professional submits (active + actually exist) before persisting them.
 * Category CRUD itself belongs to a future catalog-admin module, not here.
 */
export interface ServiceCategoryRepository {
  listActive(): Promise<ServiceCategoryRecord[]>;
  findActiveByIds(ids: string[]): Promise<ServiceCategoryRecord[]>;
}
