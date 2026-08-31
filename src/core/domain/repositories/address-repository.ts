export interface AddressRecord {
  id: string;
  line1: string;
  line2: string | null;
  city: string;
  province: string | null;
  postalCode: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
}

export interface UpsertAddressData {
  line1: string;
  line2?: string | null;
  city: string;
  province?: string | null;
  postalCode: string;
  country: string;
  /**
   * Maps & Geolocation module (Module 20) columns — already present on
   * `Address` in schema.prisma but, until Professional Onboarding, never
   * threaded through this DTO by any caller (the Profile module's own
   * "edit my address" form never resolved/stored them). Optional: the
   * Profile module's `UpdateProfileUseCase` still never supplies these,
   * so its existing behavior is unchanged.
   */
  latitude?: number | null;
  longitude?: number | null;
}

/**
 * Narrow interface for the one thing the Profile module needs: a user's
 * single default/primary address. Not a general-purpose address book
 * (Address already supports multiple typed addresses per user — see
 * schema.prisma — but "change address" in a profile form is one address,
 * not a book). A future Addresses feature can add its own broader
 * interface without this one needing to change.
 */
export interface AddressRepository {
  findPrimaryByUserId(userId: string): Promise<AddressRecord | null>;
  upsertPrimaryForUser(userId: string, data: UpsertAddressData): Promise<AddressRecord>;

  /**
   * Module 88 — GDPR Erasure Execution: clears every address line/label/
   * geo-coordinate on every address row this user owns (not just the
   * primary one — see the Prisma implementation) and soft-deletes them
   * (`deletedAt`, same convention every other read on this table already
   * filters on). Idempotent: re-running against an already-erased address
   * is a harmless no-op (`WHERE deletedAt IS NULL`).
   */
  eraseForUser(userId: string): Promise<void>;
}
