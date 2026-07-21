import type { AddressRepository } from "@/domain/repositories/address-repository";
import type { UserRepository } from "@/domain/repositories/user-repository";
import type { UpdateProfileInput } from "@/application/dto/profile.dto";

export class UpdateProfileUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly addresses: AddressRepository,
  ) {}

  async execute(userId: string, input: UpdateProfileInput): Promise<void> {
    await this.users.updateProfile(userId, {
      name: input.name,
      phone: input.phone || null,
      timezone: input.timezone,
      preferredLanguageId: input.preferredLanguageId,
      notificationPreferences: input.notificationPreferences,
    });

    if (input.address) {
      await this.addresses.upsertPrimaryForUser(userId, {
        line1: input.address.line1,
        line2: input.address.line2 || null,
        city: input.address.city,
        province: input.address.province || null,
        postalCode: input.address.postalCode,
        country: input.address.country,
      });
    }
  }
}
