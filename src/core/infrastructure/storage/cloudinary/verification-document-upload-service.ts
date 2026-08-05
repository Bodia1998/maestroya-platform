import { randomUUID } from "node:crypto";

import { cloudinary } from "@/infrastructure/storage/cloudinary/client";
import type { VerificationDocumentUploadService } from "@/application/interfaces/verification-document-upload-service";
import {
  ALLOWED_VERIFICATION_DOCUMENT_MIME_TYPES,
  MAX_VERIFICATION_DOCUMENT_BYTES,
} from "@/application/dto/verification.dto";
import { assertFileSignatureMatches } from "@/infrastructure/storage/file-signature";

/**
 * Professional Verification module (Module 17): reuses the exact same
 * Cloudinary SDK client and `upload_stream` mechanism as
 * CloudinaryAvatarUploadService / CloudinaryRequestPhotoUploadService — only
 * the folder scheme, `resource_type: "auto"` (so PDFs upload as raw, not just
 * images) and `type: "private"` differ.
 *
 * `type: "private"` means the returned URL is not publicly guessable/served —
 * verification documents are sensitive personal data and are only ever read
 * back by the owning professional or an admin through this module's
 * authorization-checked use cases. (Rendering a private asset requires a
 * signed URL; issuing those on the secure admin/owner read path is a
 * deliberate follow-up noted in the module docs — the important property here
 * is that the raw URL is never exposed on any public response.)
 */
export class CloudinaryVerificationDocumentUploadService implements VerificationDocumentUploadService {
  async uploadVerificationDocument(
    verificationId: string,
    fileBuffer: Buffer,
    contentType: string,
  ): Promise<string> {
    // Re-checked here too (not just in the Server Action) — same
    // defense-in-depth rationale as the other Cloudinary upload services.
    if (
      !ALLOWED_VERIFICATION_DOCUMENT_MIME_TYPES.includes(
        contentType as (typeof ALLOWED_VERIFICATION_DOCUMENT_MIME_TYPES)[number],
      )
    ) {
      throw new Error("Documents must be a JPEG, PNG, WebP image or a PDF.");
    }
    if (fileBuffer.byteLength > MAX_VERIFICATION_DOCUMENT_BYTES) {
      throw new Error("Each document must be smaller than 10MB.");
    }
    // Module 33 — Security Hardening: verify actual file bytes, not just
    // the attacker-controlled declared Content-Type — see file-signature.ts.
    assertFileSignatureMatches(
      fileBuffer,
      ALLOWED_VERIFICATION_DOCUMENT_MIME_TYPES,
      "Document file content does not match a JPEG, PNG, WebP image, or PDF.",
    );

    return new Promise<string>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: `maestroya/verifications/${verificationId}`,
          public_id: randomUUID(),
          resource_type: "auto",
          type: "private",
          overwrite: false,
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
