import { PrismaAddressRepository } from "@/infrastructure/database/prisma/repositories/prisma-address-repository";
import { PrismaAuthTokenRepository } from "@/infrastructure/database/prisma/repositories/prisma-auth-token-repository";
import { PrismaUserRepository } from "@/infrastructure/database/prisma/repositories/prisma-user-repository";
import { CloudinaryAvatarUploadService } from "@/infrastructure/storage/cloudinary/avatar-upload-service";
import { ChangePasswordUseCase } from "@/application/use-cases/profile/change-password.use-case";
import { DeleteAccountUseCase } from "@/application/use-cases/profile/delete-account.use-case";
import { makeExecuteAccountErasureUseCase } from "@/application/use-cases/gdpr/compose";
import { GetProfileUseCase } from "@/application/use-cases/profile/get-profile.use-case";
import { UpdateProfileUseCase } from "@/application/use-cases/profile/update-profile.use-case";
import { UploadAvatarUseCase } from "@/application/use-cases/profile/upload-avatar.use-case";

const users = new PrismaUserRepository();
const addresses = new PrismaAddressRepository();
const tokens = new PrismaAuthTokenRepository();
const avatarUploadService = new CloudinaryAvatarUploadService();

export function makeGetProfileUseCase() {
  return new GetProfileUseCase(users, addresses);
}

export function makeUpdateProfileUseCase() {
  return new UpdateProfileUseCase(users, addresses);
}

export function makeUploadAvatarUseCase() {
  return new UploadAvatarUseCase(users, avatarUploadService);
}

export function makeChangePasswordUseCase() {
  return new ChangePasswordUseCase(users, tokens);
}

export function makeDeleteAccountUseCase() {
  return new DeleteAccountUseCase(users, makeExecuteAccountErasureUseCase());
}
