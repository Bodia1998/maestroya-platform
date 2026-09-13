import { NotFoundError, UnauthorizedError } from "@/domain/errors/domain-error";
import type { CompanyMembershipRepository } from "@/domain/repositories/company-membership-repository";
import type {
  CompanyVerificationDocumentRecord,
  CompanyVerificationRepository,
} from "@/domain/repositories/company-verification-repository";
import { canManageCompanyProfile } from "@/domain/services/company-membership-rules";
import { resolveCompanyActor } from "@/application/use-cases/company/resolve-company-actor";

export interface CompanyVerificationDocumentActor {
  userId: string;
  /** Already re-verified fresh against the DB by the caller (Route
   *  Handler) via `requireRole` when true. */
  isAdmin: boolean;
}

/**
 * Module 106 — Secure Cloudinary Document Delivery.
 *
 * Company-side mirror of `GetVerificationDocumentUseCase` — reuses the
 * exact same OWNER/ADMIN-only contract `GetCompanyVerificationUseCase`
 * (Module 18) already enforces (`resolveCompanyActor` +
 * `canManageCompanyProfile`), rather than inventing a second one. A
 * MANAGER/MEMBER of the company is authenticated and an active member,
 * but still cannot download verification documents — matching
 * `GetCompanyVerificationUseCase`'s own restriction exactly (Threat 3 —
 * cross-company access is the headline concern, but this also covers
 * "same company, wrong role").
 *
 * `resolveCompanyActor` itself throws the same `NotFoundError` for "not a
 * member of this company" as it would for a nonexistent company id — that
 * safe-denial contract is preserved unchanged here.
 */
export class GetCompanyVerificationDocumentUseCase {
  constructor(
    private readonly verifications: CompanyVerificationRepository,
    private readonly memberships: CompanyMembershipRepository,
  ) {}

  async execute(actor: CompanyVerificationDocumentActor, documentId: string): Promise<CompanyVerificationDocumentRecord> {
    const document = await this.verifications.findDocumentById(documentId);
    if (!document) {
      throw new NotFoundError("CompanyVerificationDocument", documentId);
    }

    if (actor.isAdmin) {
      return document;
    }

    const verification = await this.verifications.findById(document.verificationId);
    if (!verification) {
      throw new NotFoundError("CompanyVerificationDocument", documentId);
    }

    const companyActor = await resolveCompanyActor(actor.userId, verification.companyProfileId, this.memberships);
    if (!canManageCompanyProfile(companyActor.role)) {
      throw new UnauthorizedError("Only a company owner or admin may view verification documents.");
    }

    return document;
  }
}
