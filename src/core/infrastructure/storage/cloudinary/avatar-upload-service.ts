import { cloudinary } from "@/infrastructure/storage/cloudinary/client";
import type { AvatarUploadService } from "@/application/interfaces/avatar-upload-service";
import { ALLOWED_AVATAR_MIME_TYPES, MAX_AVATAR_BYTES } from "@/application/dto/profile.dto";

export class CloudinaryAvatarUploadService implements AvatarUploadService {
  async uploadAvatar(userId: string, fileBuffer: Buffer, contentType: string): Promise<string> {
    // Re-checked here too (not just in the Server Action) — this service
    // shouldn't blindly trust its caller either; any future caller that
    // skips the action-level check still can't upload a bad file type.
    if (!ALLOWED_AVATAR_MIME_TYPES.includes(contentType as (typeof ALLOWED_AVATAR_MIME_TYPES)[number])) {
      throw new Error("Avatar must be a JPEG, PNG, or WebP image.");
    }
    if (fileBuffer.byteLength > MAX_AVATAR_BYTES) {
      throw new Error("Avatar must be smaller than 5MB.");
    }

    return new Promise<string>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: "maestroya/avatars",
          public_id: userId,
          overwrite: true,
          transformation: [{ width: 512, height: 512, crop: "fill", gravity: "face" }],
        },
        (error, result) => {
          if (error || !result) {
            reject(error ?? new Error("Cloudinary upload failed with no result."));
            return;
          }
          resolve(result.secure_url);
        },
      );
      uploadStream.end(fileBuffer);
    });
  }
}
