import "server-only";

/**
 * Module 33 — Security Hardening (File Upload Security).
 *
 * Every Cloudinary upload service in this module (avatar, request photo,
 * professional verification document, company verification document)
 * already re-validated the *declared* `contentType`/MIME string against an
 * allowlist as defense-in-depth against a Server Action skipping its own
 * check. That declared value, however, is nothing more than the browser's
 * `File.type` — entirely attacker-controlled. A malicious actor can attach
 * an arbitrary file (an HTML/SVG document with an embedded `<script>`, a
 * polyglot GIF/JS file, etc.) and simply relabel it `image/png` client-side;
 * every previous check would pass it straight through to Cloudinary, which
 * would then serve it back — under a `res.cloudinary.com` URL this app's own
 * CSP `img-src`/`connect-src` already trusts — as attacker-controlled
 * content reachable from an authenticated session.
 *
 * This module closes that gap by sniffing the file's actual magic bytes
 * (the same technique browsers/OS file-type detection use) and requiring
 * them to match one of the MIME types already allowlisted by the caller,
 * in addition to (never instead of) the existing declared-Content-Type
 * check. Deliberately dependency-free — the four file types this app
 * accepts (JPEG, PNG, WebP, PDF) all have simple, well-known fixed-offset
 * signatures, so pulling in a file-type-sniffing library would be
 * disproportionate for this fixed, small allowlist.
 */

export type SniffableMimeType = "image/jpeg" | "image/png" | "image/webp" | "application/pdf";

/**
 * Returns the MIME type implied by `buffer`'s magic bytes, or `null` if it
 * doesn't match any signature this app accepts uploads for. Intentionally
 * conservative: an unrecognized signature is `null`, not a guess.
 */
function sniffMimeType(buffer: Buffer): SniffableMimeType | null {
  // JPEG: FF D8 FF
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buffer.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((byte, i) => buffer[i] === byte)) {
    return "image/png";
  }

  // WebP: "RIFF" .... "WEBP" (bytes 0-3 and 8-11 — bytes 4-7 are a file-size field)
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }

  // PDF: "%PDF-"
  if (buffer.length >= 5 && buffer.toString("ascii", 0, 5) === "%PDF-") {
    return "application/pdf";
  }

  return null;
}

/**
 * Throws if `buffer`'s actual file signature doesn't match one of
 * `allowedMimeTypes`. Called by every Cloudinary upload service right
 * before the network call, after the existing declared-Content-Type check
 * — this is an additional, independent gate, not a replacement.
 */
export function assertFileSignatureMatches(
  buffer: Buffer,
  allowedMimeTypes: readonly string[],
  errorMessage: string,
): void {
  const sniffed = sniffMimeType(buffer);
  if (!sniffed || !allowedMimeTypes.includes(sniffed)) {
    throw new Error(errorMessage);
  }
}
