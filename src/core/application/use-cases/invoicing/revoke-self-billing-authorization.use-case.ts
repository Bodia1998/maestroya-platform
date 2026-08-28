import { ValidationError } from "@/domain/errors/domain-error";
import type {
  SelfBillingAuthorizationRecord,
  SelfBillingAuthorizationRepository,
} from "@/domain/repositories/self-billing-authorization-repository";

/**
 * Module 79 — Invoicing & Credit Notes: lets a professional/company (or an
 * admin) withdraw an ACTIVE self-billing authorization. Revoking does NOT
 * retroactively affect any invoice already DRAFTed/ACCEPTED/ISSUED under
 * it — those remain exactly as they are (see `invoice-lifecycle.ts`);
 * this only blocks `CreateProfessionalInvoiceDraftUseCase` from starting a
 * new invoice going forward, via `isSelfBillingAuthorized`.
 *
 * `SelfBillingAuthorizationRepository.revoke` is the single source of
 * truth for whether the transition is valid (it throws `NotFoundError`
 * for an unknown id and is idempotent for an already-REVOKED one) — this
 * use case only validates its own inputs and delegates.
 */
export class RevokeSelfBillingAuthorizationUseCase {
  constructor(private readonly authorizations: SelfBillingAuthorizationRepository) {}

  async execute(authorizationId: string, revokedByUserId: string): Promise<SelfBillingAuthorizationRecord> {
    if (!authorizationId.trim()) {
      throw new ValidationError("authorizationId is required.");
    }
    if (!revokedByUserId.trim()) {
      throw new ValidationError("revokedByUserId is required.");
    }
    return this.authorizations.revoke(authorizationId, revokedByUserId, new Date());
  }
}
