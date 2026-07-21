import type { AvatarUploadService } from "@/application/interfaces/avatar-upload-service";
import type { UserRepository } from "@/domain/repositories/user-repository";

export class UploadAvatarUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly avatarUploadService: AvatarUploadService,
  ) {}

  async execute(userId: string, fileBuffer: Buffer, contentType: string): Promise<string> {
    const imageUrl = await this.avatarUploadService.uploadAvatar(userId, fileBuffer, contentType);
    await this.users.updateAvatar(userId, imageUrl);
    return imageUrl;
  }
}
