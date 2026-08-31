import { cloudinary } from "@/infrastructure/storage/cloudinary/client";
import type { VerificationDocumentStorageDeleter } from "@/application/interfaces/verification-document-storage-deleter";

const RAW_EXTENSIONS = new Set(["pdf"]);

/**
 * Module 88 — GDPR Erasure Execution & Document Retention.
 *
 * Counterpart to `CloudinaryVerificationDocumentUploadService` — same
 * client, same `type: "private"` delivery this module's documents were
 * uploaded with (see that service's own doc comment). Cloudinary's
 * `destroy` API needs the asset's `public_id` plus the `resource_type`
 * ("image" | "raw") and `type` ("private") it was uploaded with; none of
 * those are stored anywhere on `ProfessionalVerificationDocument` (only
 * the resulting `fileUrl` is), so this recovers them from the URL itself —
 * `CloudinaryVerificationDocumentUploadService.uploadVerificationDocument`
 * always uploads with `public_id: randomUUID()` inside the
 * `maestroya/verifications/${verificationId}` folder and
 * `resource_type: "auto"` (Cloudinary itself resolves "auto" to "image"
 * for JPEG/PNG/WebP and "raw" for PDF at upload time — the delivery URL's
 * own path segment then tells us which one it picked).
 */
export class CloudinaryVerificationDocumentDeletionService implements VerificationDocumentStorageDeleter {
  async deleteByUrl(fileUrl: string): Promise<void> {
    const parsed = parseCloudinaryUrl(fileUrl);
    if (!parsed) {
      // A URL that doesn't match this adapter's own upload convention
      // (e.g. already hand-edited data, or a future non-Cloudinary
      // fileUrl) can't be resolved into a public_id — there's nothing safe
      // to delete. Not a network/provider failure, so it does not throw:
      // the caller's retry loop would never succeed on a later attempt
      // either. Logged by the caller (ExecuteAccountErasureUseCase) via
      // its own failure reporter instead.
      throw new UnresolvableStorageUrlError(fileUrl);
    }

    try {
      const result = await cloudinary.uploader.destroy(parsed.publicId, {
        resource_type: parsed.resourceType,
        type: "private",
        invalidate: true,
      });
      // Cloudinary's `destroy` never rejects for "already gone" — it
      // resolves with `{ result: "not found" }`. Treated as success (the
      // file is absent either way) so a retry after a prior successful-
      // but-unconfirmed delete converges instead of failing forever.
      if (result?.result !== "ok" && result?.result !== "not found") {
        throw new Error(`Cloudinary destroy returned unexpected result: ${JSON.stringify(result)}`);
      }
    } catch (error) {
      if (error instanceof UnresolvableStorageUrlError) throw error;
      throw new StorageDeletionFailedError(fileUrl, error);
    }
  }
}

export class UnresolvableStorageUrlError extends Error {
  constructor(readonly fileUrl: string) {
    super(`Could not resolve a Cloudinary public_id from URL: ${fileUrl}`);
    this.name = "UnresolvableStorageUrlError";
  }
}

export class StorageDeletionFailedError extends Error {
  constructor(
    readonly fileUrl: string,
    override readonly cause: unknown,
  ) {
    super(`Cloudinary deletion failed for URL: ${fileUrl}`);
    this.name = "StorageDeletionFailedError";
  }
}

function parseCloudinaryUrl(fileUrl: string): { publicId: string; resourceType: "image" | "raw" } | null {
  let path: string;
  try {
    path = new URL(fileUrl).pathname;
  } catch {
    return null;
  }

  const segments = path.split("/").filter(Boolean);
  // Expected shape: /<cloud_name>/<resource_type>/private/s--<sig>--/v<version>/<public_id...>.<ext>
  // or, for some private-delivery URLs, without the signature segment:
  // /<cloud_name>/<resource_type>/private/v<version>/<public_id...>.<ext>
  const versionIndex = segments.findIndex((segment) => /^v\d+$/.test(segment));
  if (versionIndex === -1 || versionIndex === segments.length - 1) return null;

  const resourceTypeSegment = segments[1];
  const resourceType: "image" | "raw" = resourceTypeSegment === "raw" ? "raw" : "image";

  const publicIdWithExtension = segments.slice(versionIndex + 1).join("/");
  const lastDot = publicIdWithExtension.lastIndexOf(".");
  const extension = lastDot === -1 ? "" : publicIdWithExtension.slice(lastDot + 1).toLowerCase();
  const publicId = lastDot === -1 ? publicIdWithExtension : publicIdWithExtension.slice(0, lastDot);
  if (!publicId) return null;

  // Belt-and-braces cross-check against the file extension, in case the
  // URL's own resource_type segment is ever "auto" rather than the
  // resolved "image"/"raw" (Cloudinary's actual delivery URLs always
  // resolve it, but this keeps the parser correct if that ever changes).
  const inferredType: "image" | "raw" = RAW_EXTENSIONS.has(extension) ? "raw" : resourceType;

  return { publicId, resourceType: inferredType };
}
