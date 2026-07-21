import { NotFoundError } from "@/domain/errors/domain-error";
import type { AddressRepository } from "@/domain/repositories/address-repository";
import type { UserProfileRecord } from "@/domain/repositories/user-repository";
import type { UserRepository } from "@/domain/repositories/user-repository";

export class GetProfileUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly addresses: AddressRepository,
  ) {}

  async execute(userId: string): Promise<{
    profile: UserProfileRecord;
    address: Awaited<ReturnType<AddressRepository["findPrimaryByUserId"]>>;
  }> {
    const profile = await this.users.findProfileById(userId);
    if (!profile) {
      throw new NotFoundError("User", userId);
    }
    const address = await this.addresses.findPrimaryByUserId(userId);
    return { profile, address };
  }
}
