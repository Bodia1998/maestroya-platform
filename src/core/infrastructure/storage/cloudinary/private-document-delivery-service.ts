import "server-only";

import { isCloudinaryDeliveryUrl, parseCloudinaryPrivateAssetUrl } from "@/infrastructure/storage/cloudinary/private-asset-locator";

/**
 * Module 106 — Secure Cloudinary Document Delivery.
 *
 * This is the chosen fix for the Module 103 / Module 105 finding: private
 * verification documents were uploaded correctly (`type: "private"`), but
 * the Cloudinary-signed `secure_url` Cloudinary returns at upload time is
 * permanent (it never expires — Cloudinary's own path-signature scheme has
 * no time component) and was being persisted verbatim and then rendered
 * directly as an `<a href>` on the two admin review pages. Once that URL
 * reached a browser, it was a bare-bearer-token: anyone who ever saw it
 * (page HTML, browser history, a shared screenshot, a proxy log) had
 * unauthenticated, un-revocable, permanent access to that one document —
 * completely bypassing this application's own authorization layer for
 * every access after the first.
 *
 * The fix is a server-side authenticated proxy, not a re-signed
 * short-lived Cloudinary URL: the new download Route Handlers
 * (`/api/documents/verification/[documentId]`,
 * `/api/documents/company-verification/[documentId]`) check ownership/
 * admin authorization on *every single request* (reusing this module's
 * existing session + ownership/role logic — see those routes), then this
 * service fetches the document's bytes from Cloudinary using the
 * already-stored `fileUrl` and the route streams them back — the
 * Cloudinary URL itself is never sent to the browser, so there is no
 * secondary artifact left over that could leak and keep working. This
 * also sidesteps entirely whether Cloudinary's own signed-URL scheme can
 * be made to expire (it would need this account's "strict token-based
 * authentication" enabled and every existing asset re-typed
 * `"authenticated"`, a materially larger and riskier change than Module
 * 106's mandate allows — see the module's final report, "Chosen Security
 * Mechanism"): access is instead time-limited by this application's own
 * session lifetime, re-checked on every request, which is a strictly
 * stronger and fully self-controlled guarantee.
 *
 * `fileUrl` here is never client input — it only ever comes from a
 * `VerificationDocumentRecord`/`CompanyVerificationDocumentRecord` already
 * loaded from this database, themselves only ever written by
 * `CloudinaryVerificationDocumentUploadService`/
 * `CloudinaryCompanyVerificationDocumentUploadService`. `isCloudinaryDeliveryUrl`
 * is still checked before every outbound fetch anyway, as a defense-in-
 * depth guarantee that this proxy can never be turned into a generic
 * "fetch an arbitrary URL from the server" primitive (Threat 9 in the
 * module's threat model) — not because client input reaches this path
 * today.
 */
export class UnresolvableDocumentUrlError extends Error {
  constructor(readonly fileUrl: string) {
    super("This document's storage reference could not be resolved.");
    this.name = "UnresolvableDocumentUrlError";
  }
}

export class DocumentDeliveryFailedError extends Error {
  constructor(
    readonly fileUrl: string,
    override readonly cause: unknown,
  ) {
    super("Failed to retrieve this document from storage.");
    this.name = "DocumentDeliveryFailedError";
  }
}

export interface PrivateDocumentPayload {
  /** Raw bytes — small (≤10MB, enforced at upload — see
   *  `MAX_VERIFICATION_DOCUMENT_BYTES`/`MAX_COMPANY_VERIFICATION_DOCUMENT_BYTES`),
   *  so buffering the whole document server-side before responding is
   *  fine and keeps the Route Handler simple; no need for a streamed
   *  `ReadableStream` pass-through for files this size. */
  body: Buffer;
}

/**
 * Fetches a private verification document's bytes from Cloudinary,
 * server-side only. Never called with, and never returns, anything the
 * browser sees directly — the caller (a Route Handler) is responsible for
 * setting its own response headers (`Content-Type` from the DB record,
 * never from Cloudinary's response, plus `Cache-Control: private,
 * no-store` and `X-Content-Type-Options: nosniff`) and streaming this
 * back as its own response body.
 */
export class CloudinaryPrivateDocumentDeliveryService {
  async fetchDocument(fileUrl: string): Promise<PrivateDocumentPayload> {
    if (!isCloudinaryDeliveryUrl(fileUrl)) {
      throw new UnresolvableDocumentUrlError(fileUrl);
    }
    // Confirms this is actually one of this module's own private-upload
    // URLs before ever fetching it — same "don't blindly trust a URL
    // string" discipline `CloudinaryVerificationDocumentDeletionService`
    // already applies before calling `destroy`.
    if (!parseCloudinaryPrivateAssetUrl(fileUrl)) {
      throw new UnresolvableDocumentUrlError(fileUrl);
    }

    let response: Response;
    try {
      response = await fetch(fileUrl, { cache: "no-store" });
    } catch (error) {
      throw new DocumentDeliveryFailedError(fileUrl, error);
    }

    if (!response.ok) {
      throw new DocumentDeliveryFailedError(fileUrl, new Error(`Cloudinary responded with status ${response.status}`));
    }

    const arrayBuffer = await response.arrayBuffer();
    return { body: Buffer.from(arrayBuffer) };
  }
}
