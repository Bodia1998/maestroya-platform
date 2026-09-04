import { NotFoundError, UnauthorizedError } from "@/domain/errors/domain-error";
import { decidePurgeRetry, type CloudinaryPurgeRetryConfig } from "@/domain/services/gdpr-cloudinary-purge-policy";
import {
  classifyStorageDeletionError,
  describeCloudinaryPurgeError,
} from "@/infrastructure/storage/cloudinary/cloudinary-purge-error-classifier";
import { AccountErasureExecuted } from "@/domain/events/account-erasure-executed";
import type { DeletionStrategyValue, GdprDataCategoryValue } from "@/domain/services/gdpr-privacy-rules";
import type { EventBus } from "@/application/ports/event-bus";
import { EventDispatchError } from "@/application/ports/event-dispatch-error";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";
import type { VerificationDocumentStorageDeleter } from "@/application/interfaces/verification-document-storage-deleter";
import type { AddressRepository } from "@/domain/repositories/address-repository";
import type { AuthTokenRepository } from "@/domain/repositories/auth-token-repository";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { NotificationRepository } from "@/domain/repositories/notification-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { ProfessionalVerificationRepository } from "@/domain/repositories/professional-verification-repository";
import type { UserRepository } from "@/domain/repositories/user-repository";
import type { FraudTrustSignalCheckRepository } from "@/domain/repositories/fraud-trust-signal-check-repository";
import type { MarketingAttributionRepository } from "@/domain/repositories/marketing-attribution-repository";
import type { PartnerRepository } from "@/domain/repositories/partner-repository";

/**
 * Module 88 — GDPR Erasure Execution & Document Retention.
 *
 * The narrow set of repositories `ExecuteAccountErasureUseCase` needs —
 * deliberately not the full `GdprInventoryRepos` bag Module 38's
 * `PrepareAccountDeletionUseCase`/`ExportPersonalDataUseCase` share (those
 * two are read-only inventory gathering across *every* category; this is a
 * write path that only ever touches the categories classified HARD_DELETE
 * or ANONYMIZE — see `gdpr-privacy-rules.ts`. RETAIN categories
 * (MARKETPLACE_FINANCIAL, DISPUTES_AND_SUPPORT, AUDIT_LOG, CONSENT_RECORDS)
 * are, by definition, never written to by this use case at all — no
 * repository for any of them appears here).
 */
export interface GdprErasureRepos {
  users: UserRepository;
  addresses: AddressRepository;
  customerProfiles: CustomerProfileRepository;
  professionals: ProfessionalRepository;
  notifications: NotificationRepository;
  professionalVerifications: ProfessionalVerificationRepository;
  authTokens: AuthTokenRepository;
  // Module 93 — Real Fraud & Trust Signal Providers: optional so every
  // pre-existing caller/test that builds GdprErasureRepos without it keeps
  // compiling unchanged. When present, FraudTrustSignalCheck rows for this
  // user are hard-deleted alongside every other per-user erasure step —
  // see that model's own doc comment (module brief requirement #14: these
  // rows are provider-call telemetry, not part of the RETAIN-classified
  // audit/financial/dispute record, so hard-delete is appropriate and
  // does not need a new formal GdprDataCategoryValue).
  fraudTrustSignalChecks?: FraudTrustSignalCheckRepository;
  // Module 96 — Referral & Affiliate Production Wiring: optional, same
  // "every pre-existing caller/test keeps compiling unchanged" convention
  // as `fraudTrustSignalChecks` above. When present, this user's
  // MarketingAttribution link and (if they are themselves a partner)
  // their Partner row's own PII are anonymized alongside every other
  // per-user erasure step — see `MarketingAttributionRepository.
  // eraseForUser`/`PartnerRepository.eraseForUser`'s own doc comments.
  // AffiliateCommission/PartnerPayout/AffiliateCommissionReversal rows
  // are never touched here — see AFFILIATE_FINANCIAL's own RETAIN
  // classification (gdpr-privacy-rules.ts).
  marketingAttributions?: MarketingAttributionRepository;
  partners?: PartnerRepository;
}

/**
 * Who is invoking erasure, resolved by the caller (a Server Action/route
 * that has already run `requireAuth()`/`requireRole()` — see rbac.ts) —
 * this use case never reads a session itself, same "authorization resolved
 * at the edge, use case trusts its inputs" convention as every other use
 * case in this codebase. `isAdmin` must be derived from a *fresh* role
 * check (e.g. `requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN)`, which itself
 * re-verifies against the database — see rbac.ts's own doc comment), never
 * from a possibly-stale JWT claim alone.
 */
export interface AccountErasureActor {
  userId: string;
  isAdmin: boolean;
}

export interface AccountErasureResult {
  userId: string;
  /** True if this call performed no new anonymization — either because a
   *  previous call already completed it (idempotent replay) or because a
   *  concurrent call won the race (see `UserRepository.eraseAccount`'s own
   *  doc comment). Either way, the document-storage-purge retry below
   *  still ran. */
  alreadyErased: boolean;
  categoriesProcessed: Partial<Record<GdprDataCategoryValue, DeletionStrategyValue>>;
  documentsMarkedDeleted: number;
  documentsStoragePurged: number;
  documentsStoragePurgeFailures: number;
}

/**
 * GDPR Article 17 (right to erasure) — the *execution* step Module 38
 * deliberately stopped short of (see `PrepareAccountDeletionUseCase`'s own
 * doc comment: "never performs an irreversible delete"). This is that
 * follow-through: given a userId already vetted by
 * `PrepareAccountDeletionUseCase`/an admin review, actually applies the
 * classification `gdpr-privacy-rules.ts` decided — HARD_DELETE and
 * ANONYMIZE categories are mutated; RETAIN categories are never touched by
 * this class at all (see `GdprErasureRepos`'s own doc comment).
 *
 * **Never hard-deletes the User row.** Every table that references a user
 * (Message, Review, CompanyMember, Job, Invoice, Dispute, ...) does so
 * through an `onDelete: Restrict` or `SetNull` foreign key — deliberately,
 * so those records keep resolving to *something* after the person leaves.
 * Anonymizing the one shared `User` row (name/email/phone/image/password
 * cleared, see `UserRepository.eraseAccount`) therefore anonymizes every
 * one of those joins for free, with zero additional writes to
 * Message/Review/CompanyMember/etc. — this is why `PROFILE_DATA`,
 * `MARKETPLACE_ACTIVITY`, `MESSAGES`, `REVIEWS`, and `COMPANY_MEMBERSHIP`
 * (all classified ANONYMIZE) have no corresponding repository call below
 * beyond the User row itself, `Address`, `CustomerProfile.notes`, and
 * `ProfessionalProfile`'s own PII fields — the only places personal data
 * is actually *copied* outside the User row for those categories.
 *
 * **Transaction boundaries.** This does not wrap every repository call in
 * one cross-repository database transaction — there is no single
 * transaction handle spanning `UserRepository`/`AddressRepository`/
 * `NotificationRepository`/etc. in this codebase's architecture (each is
 * its own narrow Prisma-backed repository — see `GdprErasureRepos`'s own
 * doc comment). Instead, every individual write this method performs is
 * independently idempotent (each interface method's own doc comment
 * documents why), so a crash or partial failure between any two steps
 * below is always safe to retry: re-calling `execute` re-derives the same
 * outcome, re-applying only the steps that have not yet happened.
 * External storage deletion (the Cloudinary purge, step 2 below) is
 * additionally never allowed to fail or roll back anything the database
 * already committed — see step 2's own comment.
 *
 * **Auth invalidation and its known limitation.** `passwordHash` is
 * cleared (blocks Credentials sign-in outright — `authorize()` in
 * auth-config.ts already rejects any user with no passwordHash),
 * `RefreshToken`s are revoked, NextAuth `Session`/`Account` rows are
 * hard-deleted (blocks a future OAuth sign-in from silently resuming this
 * identity). What this cannot do: this app's cookie session strategy is
 * `"jwt"` (see auth-config.ts's own doc comment for why), so an
 * *already-issued* JWT session cookie is not server-revocable — it stays
 * cryptographically valid, for ordinary (non-admin-tier) requests, until
 * it naturally expires (up to `REMEMBER_ME_SESSION_MAX_AGE_SECONDS` = 30
 * days). This is the exact same trade-off `requireRole()` in rbac.ts
 * already documents and deliberately accepts for admin-tier freshness (a
 * fresh DB check on every single authenticated request was rejected there
 * as disproportionate cost) — extending that per-request DB check to every
 * ordinary request platform-wide is a materially larger, riskier change
 * than this module's scope, so it is called out here as a known limitation
 * rather than silently worked around. Every *admin-tier* action remains
 * fully protected today (`requireRole` re-checks `status === "ACTIVE"` on
 * every call, and this erasure sets `status` to `DEACTIVATED`).
 */
export class ExecuteAccountErasureUseCase {
  constructor(
    private readonly repos: GdprErasureRepos,
    private readonly documentStorage: VerificationDocumentStorageDeleter,
    private readonly eventBus: EventBus,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
    // Module 94 — GDPR Cloudinary Purge Retry & Durable Erasure
    // Completion. Defaulted so every pre-existing caller/test keeps
    // compiling unchanged (same convention as `fraudTrustSignalChecks`
    // above). A conservative default (1 attempt, 60s base delay) is safe
    // even for a caller that never overrides it: this inline attempt is
    // always attempt 1 of whatever `RetryPendingCloudinaryPurgesUseCase`
    // ultimately enforces via its own, separately-configured
    // `GDPR_CLOUDINARY_PURGE_MAX_ATTEMPTS` — see `compose.ts`'s wiring,
    // which passes the real `env`-derived config to both.
    private readonly purgeRetryConfig: CloudinaryPurgeRetryConfig = { maxAttempts: 8, baseDelayMs: 60_000 },
  ) {}

  async execute(userId: string, actor: AccountErasureActor): Promise<AccountErasureResult> {
    if (actor.userId !== userId && !actor.isAdmin) {
      throw new UnauthorizedError("You cannot execute erasure for another user's account.");
    }

    const account = await this.repos.users.findById(userId);
    if (!account) {
      throw new NotFoundError("User", userId);
    }

    let categoriesProcessed: Partial<Record<GdprDataCategoryValue, DeletionStrategyValue>> = {};

    // --- Step 1: database anonymization/hard-delete (idempotent, retryable) ---
    const eraseResult = await this.repos.users.eraseAccount(userId);
    const anonymizedThisCall = eraseResult.erased;

    if (anonymizedThisCall) {
      await this.repos.addresses.eraseForUser(userId);
      await this.repos.customerProfiles.eraseForUser(userId);

      const professionalForErasure = await this.repos.professionals.findByUserId(userId);
      if (professionalForErasure) {
        await this.repos.professionals.update(professionalForErasure.id, {
          businessName: null,
          bio: null,
          headline: null,
          contactEmail: null,
          contactPhone: null,
          websiteUrl: null,
          taxId: null,
        });
      }

      await this.repos.notifications.deleteAllForUser(userId);

      await this.repos.authTokens.deleteEmailVerificationTokensForUser(userId);
      await this.repos.authTokens.deletePasswordResetTokensForUser(userId);
      await this.repos.authTokens.revokeAllRefreshTokensForUser(userId);
      await this.repos.users.invalidateAllSessions(userId);

      // Module 93 — Real Fraud & Trust Signal Providers.
      if (this.repos.fraudTrustSignalChecks) {
        await this.repos.fraudTrustSignalChecks.deleteForUser(userId);
      }

      // Module 96 — Referral & Affiliate Production Wiring.
      if (this.repos.marketingAttributions) {
        await this.repos.marketingAttributions.eraseForUser(userId);
      }
      if (this.repos.partners) {
        await this.repos.partners.eraseForUser(userId);
      }

      categoriesProcessed = {
        AUTH_CREDENTIALS: "HARD_DELETE",
        PROFILE_DATA: "ANONYMIZE",
        MARKETPLACE_ACTIVITY: "ANONYMIZE",
        MARKETPLACE_FINANCIAL: "RETAIN",
        MESSAGES: "ANONYMIZE",
        REVIEWS: "ANONYMIZE",
        NOTIFICATIONS: "HARD_DELETE",
        DISPUTES_AND_SUPPORT: "RETAIN",
        VERIFICATION_DOCUMENTS: "HARD_DELETE",
        AUDIT_LOG: "RETAIN",
        CONSENT_RECORDS: "RETAIN",
        COMPANY_MEMBERSHIP: "ANONYMIZE",
        REFERRAL_ATTRIBUTION: "ANONYMIZE",
        AFFILIATE_FINANCIAL: "RETAIN",
      };
    }

    // --- Step 2: verification-document lifecycle (soft-delete + retryable storage purge) ---
    // Always runs — even when step 1 did nothing this call (idempotent
    // replay, or lost a concurrent race) — because a *previous* run may
    // have soft-deleted documents but failed partway through purging their
    // Cloudinary files (network error, provider outage). Deliberately
    // never inside the same unit of work as step 1's writes, and a storage
    // failure here never undoes step 1: the account is anonymized either
    // way, and an outstanding document purge is always safe to retry on
    // the next call.
    const professional = await this.repos.professionals.findByUserId(userId);
    let documentsMarkedDeleted = 0;
    let documentsStoragePurged = 0;
    let documentsStoragePurgeFailures = 0;

    if (professional) {
      const newlySoftDeleted = await this.repos.professionalVerifications.eraseDocumentsForProfessionalProfile(
        professional.id,
      );
      documentsMarkedDeleted = newlySoftDeleted.length;

      const pendingPurge = await this.repos.professionalVerifications.listDocumentsPendingStoragePurge(
        professional.id,
      );
      for (const document of pendingPurge) {
        const attemptCount = document.storagePurgeAttemptCount + 1;
        try {
          await this.documentStorage.deleteByUrl(document.fileUrl);
          await this.repos.professionalVerifications.markDocumentStoragePurged(document.id);
          documentsStoragePurged += 1;
        } catch (error) {
          documentsStoragePurgeFailures += 1;
          // Module 94: persist durable retry state the instant this
          // first attempt fails — never only the in-memory
          // `documentsStoragePurgeFailures` counter below, which this
          // call's own caller never sees again once this method returns.
          // A scheduled `RetryPendingCloudinaryPurgesUseCase` invocation
          // (or, for a document still soft-deleted-but-unpurged from a
          // *prior* run, a future call to *this* method — see
          // `listDocumentsPendingStoragePurge`'s own doc comment) is what
          // eventually retries it — this call never blocks on Cloudinary
          // recovering, and never rolls back the database erasure that
          // already committed in step 1 (see this class's own doc
          // comment, "Transaction boundaries").
          const category = classifyStorageDeletionError(error);
          const decision = decidePurgeRetry(attemptCount, category, this.purgeRetryConfig);
          await this.repos.professionalVerifications.recordDocumentStoragePurgeFailure(document.id, {
            attemptCount,
            nextAttemptAt: decision.nextAttemptAt,
            deadLetter: decision.deadLetter,
            errorMessage: describeCloudinaryPurgeError(category, error),
          });
          this.failureReporter.report(error instanceof Error ? error : new Error(String(error)), {
            documentId: document.id,
            professionalProfileId: professional.id,
            errorCategory: category,
            deadLetter: decision.deadLetter,
          });
        }
      }
    }

    const alreadyErased = !anonymizedThisCall;

    try {
      await this.eventBus.publishAll([
        new AccountErasureExecuted(userId, actor.userId, alreadyErased, categoriesProcessed, documentsStoragePurgeFailures),
      ]);
    } catch (error) {
      if (!(error instanceof EventDispatchError)) throw error;
      this.failureReporter.report(error, { event: error.eventName, eventId: error.eventId });
    }

    return {
      userId,
      alreadyErased,
      categoriesProcessed,
      documentsMarkedDeleted,
      documentsStoragePurged,
      documentsStoragePurgeFailures,
    };
  }
}
