import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { makeGetCompanyVerificationDocumentUseCase } from "@/application/use-cases/company-verification/compose";
import { DocumentDeliveryFailedError, CloudinaryPrivateDocumentDeliveryService, UnresolvableDocumentUrlError } from "@/infrastructure/storage/cloudinary/private-document-delivery-service";
import { UnauthorizedError } from "@/domain/errors/domain-error";
import { ROLES, requireAuth, requireRole } from "@/infrastructure/auth/rbac";
import { toHttpErrorResponse } from "@/infrastructure/observability/http-error-response";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/infrastructure/observability/request-id";
import { withApiTracing } from "@/infrastructure/tracing/http-tracing";

/**
 * Module 106 — Secure Cloudinary Document Delivery.
 *
 * Company-side mirror of `/api/documents/verification/[documentId]` —
 * see that route's own doc comment for the full rationale. Authorization:
 * an OWNER/ADMIN member of the company the document's verification case
 * belongs to (`GetCompanyVerificationDocumentUseCase` — reuses
 * `resolveCompanyActor` + `canManageCompanyProfile`, Module 18's existing
 * contract) or a platform ADMIN/SUPER_ADMIN.
 */
export const GET = withApiTracing(
  "/api/documents/company-verification/[documentId]",
  async function GET(request: NextRequest, { params }: { params: Promise<{ documentId: string }> }) {
    const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
    const headers = { [REQUEST_ID_HEADER]: requestId };
    const route = "/api/documents/company-verification/[documentId]";

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

      const document = await makeGetCompanyVerificationDocumentUseCase().execute(
        { userId: user.id, isAdmin },
        documentId,
      );

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
