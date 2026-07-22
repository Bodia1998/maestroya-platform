export interface CustomerProfileRecord {
  id: string;
  userId: string;
}

/**
 * Service Request Module: narrow interface for resolving the CustomerProfile
 * behind a signed-in user. Mirrors the "narrow, module-scoped interface"
 * convention already used by AddressRepository/ServiceCategoryRepository —
 * this only exposes the two operations the Service Request module needs,
 * not a general CustomerProfile CRUD surface.
 *
 * There is deliberately no separate "become a customer" signup step in this
 * MVP: any signed-in User can start requesting services, and their
 * CustomerProfile is created lazily the first time they do (see
 * `findOrCreateByUserId`, used only by CreateServiceRequestUseCase). Every
 * other use case in this module uses the read-only `findByUserId` — if a
 * user has no CustomerProfile yet, they cannot own any ServiceRequest, so
 * there's nothing to lazily create on a read/update/cancel path.
 */
export interface CustomerProfileRepository {
  findByUserId(userId: string): Promise<CustomerProfileRecord | null>;
  findOrCreateByUserId(userId: string): Promise<CustomerProfileRecord>;
}
