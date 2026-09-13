import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { makeGetVerificationDocumentUseCase } from "@/application/use-cases/verification/compose";
import { DocumentDeliveryFailedError, CloudinaryPrivateDocumentDeliveryService, UnresolvableDocumentUrlError } from "@/infrastructure/storage/cloudinary/private-document-delivery-service";
import { UnauthorizedError } from "@/domain/errors/domain-error";
import { ROLES, requireAuth, requireRole } from "@/infrastructure/auth/rbac";
import { toHttpErrorResponse } from "@/infrastructure/observability/http-error-response";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/infrastructure/observability/request-id";
import { withApiTracing } from "@/infrastructure/tracing/http-tracing";

/**
 * Module 106 — Secure Cloudinary Document Delivery.
 *
 * Authenticated, authorized, server-side proxy for a professional
 * verification document (Module 17). Replaces the previous pattern —
 * the admin review page rendering `doc.fileUrl` (a Cloudinary-signed URL
 * that, once uploaded, never expires) directly as an `<a href>` — with a
 * route that re-checks authorization on every single request and never
 * lets the underlying Cloudinary URL reach the browser at all. See
 * `CloudinaryPrivateDocumentDeliveryService`'s own doc comment for the
 * full rationale, and the module's final report for the threat model
 * this closes.
 *
 * Authorization: the owning professional (re-derived from the session
 * userId — never a client-supplied id, exactly like
 * `GetProfessionalVerificationUseCase`) or an ADMIN/SUPER_ADMIN (with the
 * same fresh-from-DB role re-check `requireRole` already applies to every
 * other admin-gated action in this codebase — Module 82). Anyone else,
 * or a nonexistent/soft-deleted document id, gets the identical 404 —
 * this route never distinguishes "not yours" from "doesn't exist."
 */
export const GET = withApiTracing(
  "/api/documents/verification/[documentId]",
  async function GET(request: NextRequest, { params }: { params: Promise<{ documentId: string }> }) {
    const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
    const headers = { [REQUEST_ID_HEADER]: requestId };
    const route = "/api/documents/verification/[documentId]";

    try {
      const { documentId } = await params;
      const user = await requireAuth();

      let isAdmin = false;
      try {
        await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
        isAdmin = true;
      } catch (error) {
        if (!(error instanceof UnauthorizedError)) throw error;
      }

      const document = await makeGetVerificationDocumentUseCase().execute({ userId: user.id, isAdmin }, documentId);

      const delivery = new CloudinaryPrivateDocumentDeliveryService();
      const { body } = await delivery.fetchDocument(document.fileUrl);

      const safeFilename = document.originalFilename.replace(/["\r\n]/g, "_");

      return new NextResponse(new Uint8Array(body), {
        status: 200,
        headers: {
          ...headers,
          "Content-Type": document.mimeType,
          "Content-Length": String(body.byteLength),
          "Content-Disposition": `inline; filename="${safeFilename}"`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (error) {
      if (error instanceof UnresolvableDocumentUrlError || error instanceof DocumentDeliveryFailedError) {
        return toHttpErrorResponse(new Error("This document is temporarily unavailable."), { requestId, route });
      }
      return toHttpErrorResponse(error, { requestId, route });
    }
  },
);
