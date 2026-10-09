import { ConflictError, NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type {
  ProfessionalBillingIdentityRecord,
  ProfessionalBillingIdentityRepository,
} from "@/domain/repositories/professional-billing-identity-repository";
import { isBillingIdentityComplete } from "@/domain/services/professional-billing-identity";
import {
  rejectBillingIdentitySchema,
  toAdminBillingIdentityListItem,
  toAdminBillingIdentityView,
  type AdminBillingIdentityListItem,
  type AdminBillingIdentityView,
  type RejectBillingIdentityInput,
  type VerifyBillingIdentityInput,
} from "@/application/dto/professional-billing-identity.dto";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";

/**
 * Module 146 — the ONLY code path that can make a billing identity VERIFIED (or
 * REJECTED). There is no automated provider or registry lookup in the
 * application, so verification authority is an administrator.
 *
 * Trust boundary: these use cases take the acting `adminUserId` from the caller
 * and do not re-check roles — exactly like the M17 verification use cases, the
 * Server Action (`admin/billing-identities/actions.ts`) must call
 * `requireRole(ADMIN, SUPER_ADMIN)` first. They are not exposed to professionals.
 *
 * Every decision is bound to the `revision` the administrator reviewed: if the
 * professional edited the details in the meantime (revision moved) or the row is
 * no longer awaiting review, nothing is changed and a ConflictError is raised, so
 * a stale review can never verify unreviewed content.
 */
const MSG_STALE = "This billing identity changed or was already reviewed. Reload and review the current details.";

function assertActor(adminUserId: string): void {
  if (typeof adminUserId !== "string" || adminUserId === "") throw new ValidationError("An acting administrator is required.");
}

async function recordDecision(
  audit: AdminAuditLogRepository | undefined,
  failureReporter: FailureReporter,
  action: "BILLING_IDENTITY_VERIFIED" | "BILLING_IDENTITY_REJECTED",
  adminUserId: string,
  record: ProfessionalBillingIdentityRecord,
  extra: Record<string, unknown>,
) {
  if (!audit) return;
  try {
    // Ids and enum codes only: never tax ids, names, addresses or the free-text note.
    await audit.record({
      adminUserId,
      action,
      targetType: "ProfessionalBillingIdentity",
      targetId: record.id,
      metadata: { professionalProfileId: record.professionalProfileId, revision: record.revision, ...extra },
    });
  } catch (error) {
    failureReporter.report(error, { action, identityId: record.id });
  }
}

export class VerifyBillingIdentityUseCase {
  constructor(
    private readonly identities: ProfessionalBillingIdentityRepository,
    private readonly audit?: AdminAuditLogRepository,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(adminUserId: string, input: VerifyBillingIdentityInput): Promise<AdminBillingIdentityView> {
    assertActor(adminUserId);
    const current = await this.identities.findById(input.identityId);
    if (!current) throw new NotFoundError("ProfessionalBillingIdentity", input.identityId);
    // Never verify details that are not complete and well-formed (e.g. a legacy or hand-edited row).
    if (!isBillingIdentityComplete(current)) throw new ValidationError("The billing identity is incomplete and cannot be verified.");

    const updated = await this.identities.markVerified(input.identityId, input.expectedRevision, { adminUserId, now: this.clock() });
    if (!updated) throw new ConflictError(MSG_STALE);

    await recordDecision(this.audit, this.failureReporter, "BILLING_IDENTITY_VERIFIED", adminUserId, updated, {});
    return toAdminBillingIdentityView(updated);
  }
}

export class RejectBillingIdentityUseCase {
  constructor(
    private readonly identities: ProfessionalBillingIdentityRepository,
    private readonly audit?: AdminAuditLogRepository,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(adminUserId: string, input: RejectBillingIdentityInput): Promise<AdminBillingIdentityView> {
    assertActor(adminUserId);
    const parsed = rejectBillingIdentitySchema.safeParse(input);
    if (!parsed.success) throw new ValidationError("A valid rejection reason is required.");
    const { identityId, expectedRevision, reason, note } = parsed.data;

    const current = await this.identities.findById(identityId);
    if (!current) throw new NotFoundError("ProfessionalBillingIdentity", identityId);

    const updated = await this.identities.markRejected(identityId, expectedRevision, { adminUserId, now: this.clock(), reason, note });
    if (!updated) throw new ConflictError(MSG_STALE);

    await recordDecision(this.audit, this.failureReporter, "BILLING_IDENTITY_REJECTED", adminUserId, updated, { reason });
    return toAdminBillingIdentityView(updated);
  }
}

export class GetBillingIdentityForAdminReviewUseCase {
  constructor(private readonly identities: ProfessionalBillingIdentityRepository) {}

  async execute(adminUserId: string, identityId: string): Promise<AdminBillingIdentityView> {
    assertActor(adminUserId);
    const record = await this.identities.findById(identityId);
    if (!record) throw new NotFoundError("ProfessionalBillingIdentity", identityId);
    return toAdminBillingIdentityView(record);
  }
}

export class ListBillingIdentitiesPendingReviewUseCase {
  constructor(private readonly identities: ProfessionalBillingIdentityRepository) {}

  async execute(adminUserId: string, options: { limit?: number; offset?: number } = {}): Promise<AdminBillingIdentityListItem[]> {
    assertActor(adminUserId);
    const limit = Math.min(Math.max(Math.trunc(options.limit ?? 25), 1), 100);
    const offset = Math.max(Math.trunc(options.offset ?? 0), 0);
    return (await this.identities.listPendingReview({ limit, offset })).map(toAdminBillingIdentityListItem);
  }
}
