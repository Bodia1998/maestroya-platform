import { randomUUID } from "node:crypto";

import { cloudinary } from "@/infrastructure/storage/cloudinary/client";
import type { RequestPhotoUploadService } from "@/application/interfaces/request-photo-upload-service";
import { ALLOWED_REQUEST_PHOTO_MIME_TYPES, MAX_REQUEST_PHOTO_BYTES } from "@/application/dto/service-request.dto";
import { assertFileSignatureMatches } from "@/infrastructure/storage/file-signature";

/**
 * Reuses the exact same Cloudinary upload mechanism as
 * CloudinaryAvatarUploadService (same SDK client, same upload_stream
 * pattern) — only the folder/public_id scheme and lack of a fixed
 * face-crop transformation differ, since a request can hold several
 * photos (unlike the single overwritable avatar per user).
 */
export class CloudinaryRequestPhotoUploadService implements RequestPhotoUploadService {
  async uploadRequestPhoto(serviceRequestId: string, fileBuffer: Buffer, contentType: string): Promise<string> {
    // Re-checked here too (not just in the Server Action) — same
    // defense-in-depth rationale as CloudinaryAvatarUploadService.
    if (!ALLOWED_REQUEST_PHOTO_MIME_TYPES.includes(contentType as (typeof ALLOWED_REQUEST_PHOTO_MIME_TYPES)[number])) {
      throw new Error("Photos must be a JPEG, PNG, or WebP image.");
    }
    if (fileBuffer.byteLength > MAX_REQUEST_PHOTO_BYTES) {
      throw new Error("Each photo must be smaller than 5MB.");
    }
    // Module 33 — Security Hardening: verify actual file bytes, not just
    // the attacker-controlled declared Content-Type — see file-signature.ts.
    assertFileSignatureMatches(
      fileBuffer,
      ALLOWED_REQUEST_PHOTO_MIME_TYPES,
      "Photo file content does not match a JPEG, PNG, or WebP image.",
    );

    return new Promise<string>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: `maestroya/service-requests/${serviceRequestId}`,
          public_id: randomUUID(),
          overwrite: false,
          transformation: [{ width: 1600, height: 1600, crop: "limit" }],
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
