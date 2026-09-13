/**
 * Module 106 — Secure Cloudinary Document Delivery.
 *
 * Shared parser for this codebase's own private-verification-document
 * upload convention (see `CloudinaryVerificationDocumentUploadService` /
 * `CloudinaryCompanyVerificationDocumentUploadService`): folder-scoped
 * `type: "private"` uploads whose only persisted reference is the
 * Cloudinary-returned `secure_url` (no `public_id`/`resource_type` column
 * exists on either document table — see those repositories' own doc
 * comments on why no schema change was made for this module).
 *
 * Previously this exact parsing logic lived only inside
 * `CloudinaryVerificationDocumentDeletionService` (Module 88), duplicated
 * for GDPR-purge purposes. Module 106 needs the identical
 * `fileUrl -> { publicId, resourceType }` recovery to validate/replay a
 * document's own stored URL through the new authenticated download
 * proxy (`CloudinaryPrivateDocumentDeliveryService`), so this is
 * extracted here as the single shared implementation — the deletion
 * service now imports it too, rather than the two ever being able to
 * silently drift apart. No behavior changed by the extraction itself.
 */

const RAW_EXTENSIONS = new Set(["pdf"]);

export interface CloudinaryPrivateAssetLocation {
  publicId: string;
  resourceType: "image" | "raw";
}

/**
 * Recovers `{ publicId, resourceType }` from a Cloudinary delivery URL
 * produced by this codebase's own private verification-document uploads.
 * Returns `null` for anything that doesn't match that shape — a caller
 * must treat that as "cannot be resolved," never guess a fallback.
 *
 * Expected shape: `/<cloud_name>/<resource_type>/private/s--<sig>--/v<version>/<public_id...>.<ext>`
 * or, for some private-delivery URLs, without the signature segment:
 * `/<cloud_name>/<resource_type>/private/v<version>/<public_id...>.<ext>`
 */
export function parseCloudinaryPrivateAssetUrl(fileUrl: string): CloudinaryPrivateAssetLocation | null {
  let parsed: URL;
  try {
    parsed = new URL(fileUrl);
  } catch {
    return null;
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
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
  // resolved "image"/"raw".
  const inferredType: "image" | "raw" = RAW_EXTENSIONS.has(extension) ? "raw" : resourceType;

  return { publicId, resourceType: inferredType };
}

/**
 * True only for a URL whose host is Cloudinary's own asset-delivery
 * domain (`res.cloudinary.com`) or a Cloudinary-issued custom CNAME under
 * `*.cloudinary.com` for this configured cloud — never anything else.
 *
 * Module 106 threat model, Threat 9 (Cloudinary direct access) /
 * defense-in-depth against SSRF: `fileUrl` is application-controlled data
 * (written only by the upload services above, from Cloudinary's own
 * upload-API response — never accepted as client input), so this is a
 * second, cheap guarantee rather than the primary control — the download
 * proxy must never turn into a generic "fetch any URL the DB happens to
 * contain" primitive, even if a future bug or migration ever let an
 * unexpected value into a `fileUrl` column.
 */
export function isCloudinaryDeliveryUrl(fileUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(fileUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  return parsed.hostname === "res.cloudinary.com" || parsed.hostname.endsWith(".cloudinary.com");
}
