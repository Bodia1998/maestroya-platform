import { randomUUID } from "node:crypto";

import { cloudinary } from "@/infrastructure/storage/cloudinary/client";
import type { CompanyVerificationDocumentUploadService } from "@/application/interfaces/company-verification-document-upload-service";
import {
  ALLOWED_COMPANY_VERIFICATION_DOCUMENT_MIME_TYPES,
  MAX_COMPANY_VERIFICATION_DOCUMENT_BYTES,
} from "@/application/dto/company-verification.dto";
import { assertFileSignatureMatches } from "@/infrastructure/storage/file-signature";

/** Module 18 — Company Professional: reuses the exact same Cloudinary
 *  `upload_stream` mechanism as CloudinaryVerificationDocumentUploadService
 *  (Module 17) — only the folder differs, keeping company verification
 *  documents in a distinct private namespace. Same `type: "private"` /
 *  never-publicly-exposed contract. */
export class CloudinaryCompanyVerificationDocumentUploadService implements CompanyVerificationDocumentUploadService {
  async uploadCompanyVerificationDocument(
    verificationId: string,
    fileBuffer: Buffer,
    contentType: string,
  ): Promise<string> {
    if (
      !ALLOWED_COMPANY_VERIFICATION_DOCUMENT_MIME_TYPES.includes(
        contentType as (typeof ALLOWED_COMPANY_VERIFICATION_DOCUMENT_MIME_TYPES)[number],
      )
    ) {
      throw new Error("Documents must be a JPEG, PNG, WebP image or a PDF.");
    }
    if (fileBuffer.byteLength > MAX_COMPANY_VERIFICATION_DOCUMENT_BYTES) {
      throw new Error("Each document must be smaller than 10MB.");
    }
    // Module 33 — Security Hardening: verify actual file bytes, not just
    // the attacker-controlled declared Content-Type — see file-signature.ts.
    assertFileSignatureMatches(
      fileBuffer,
      ALLOWED_COMPANY_VERIFICATION_DOCUMENT_MIME_TYPES,
      "Document file content does not match a JPEG, PNG, WebP image, or PDF.",
    );

    return new Promise<string>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: `maestroya/company-verifications/${verificationId}`,
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
