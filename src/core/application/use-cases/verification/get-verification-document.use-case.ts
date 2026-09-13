import { NotFoundError, UnauthorizedError } from "@/domain/errors/domain-error";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type {
  ProfessionalVerificationRepository,
  VerificationDocumentRecord,
} from "@/domain/repositories/professional-verification-repository";

export interface VerificationDocumentActor {
  userId: string;
  /** Already re-verified fresh against the DB by the caller (Route
   *  Handler) via `requireRole` when true — see
   *  `/api/documents/verification/[documentId]/route.ts`. */
  isAdmin: boolean;
}

/**
 * Module 106 — Secure Cloudinary Document Delivery.
 *
 * Authorization gate for the new authenticated document-download proxy —
 * deliberately thin and reuses exactly the ownership check
 * `GetProfessionalVerificationUseCase` already establishes (a
 * professional's own case is resolved from their `ProfessionalProfile`,
 * never a client-supplied id) plus the existing ADMIN/SUPER_ADMIN
 * contract every other verification read path in this module already
 * grants. No new authorization abstraction — this is the same shape as
 * `resolveJobActor`/`resolveCompanyActor`, sized for the two callers this
 * module actually has (the owning professional, or an admin).
 *
 * A document that exists but belongs to a *different* professional (or
 * was never authorized because of a role mismatch) surfaces the exact
 * same `UnauthorizedError` a nonexistent document would via NotFoundError
 * — see the route handler for how these two map to the same generic HTTP
 * denial, so an attacker probing document ids cannot distinguish
 * "doesn't exist" from "exists but isn't yours" (Threat 10 — metadata
 * leakage).
 *
 * A soft-deleted document (GDPR erasure — see `deletedAt`'s own doc
 * comment on `VerificationDocumentRecord`) is treated as not found: its
 * underlying Cloudinary file may already be purged, and it must never be
 * re-served regardless of who asks.
 */
export class GetVerificationDocumentUseCase {
  constructor(
    private readonly verifications: ProfessionalVerificationRepository,
    private readonly professionals: ProfessionalRepository,
  ) {}

  async execute(actor: VerificationDocumentActor, documentId: string): Promise<VerificationDocumentRecord> {
    const document = await this.verifications.findDocumentById(documentId);
    if (!document || document.deletedAt) {
      throw new NotFoundError("VerificationDocument", documentId);
    }

    if (actor.isAdmin) {
      return document;
    }

    const verification = await this.verifications.findById(document.verificationId);
    if (!verification) {
      throw new NotFoundError("VerificationDocument", documentId);
    }

    const professional = await this.professionals.findByUserId(actor.userId);
    if (!professional || professional.id !== verification.professionalProfileId) {
      throw new UnauthorizedError("You do not have permission to view this document.");
    }

    return document;
  }
}
