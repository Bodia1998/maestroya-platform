import type {
  AddressRecord,
  AddressRepository,
  UpsertAddressData,
} from "@/domain/repositories/address-repository";
import type { AvatarUploadService } from "@/application/interfaces/avatar-upload-service";

export class FakeAddressRepository implements AddressRepository {
  addressesByUserId = new Map<string, AddressRecord>();
  private idCounter = 0;

  async findPrimaryByUserId(userId: string) {
    return this.addressesByUserId.get(userId) ?? null;
  }

  async upsertPrimaryForUser(userId: string, data: UpsertAddressData) {
    const existing = this.addressesByUserId.get(userId);
    const record: AddressRecord = {
      id: existing?.id ?? `fake-address-${++this.idCounter}`,
      line1: data.line1,
      line2: data.line2 ?? null,
      city: data.city,
      province: data.province ?? null,
      postalCode: data.postalCode,
      country: data.country,
      latitude: data.latitude ?? null,
      longitude: data.longitude ?? null,
    };
    this.addressesByUserId.set(userId, record);
    return record;
  }
}

export class FakeAvatarUploadService implements AvatarUploadService {
  uploads: Array<{ userId: string; contentType: string; size: number }> = [];

  async uploadAvatar(userId: string, fileBuffer: Buffer, contentType: string): Promise<string> {
    this.uploads.push({ userId, contentType, size: fileBuffer.byteLength });
    return `https://res.cloudinary.com/fake/avatars/${userId}.jpg`;
  }
}
