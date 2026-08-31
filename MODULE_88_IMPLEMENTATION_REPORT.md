# Module 88 — GDPR Erasure Execution & Document Retention

## 1. Status

**Implemented and tested**, with one environmental caveat: this sandbox has no
network access to Prisma's engine-binary CDN (`binaries.prisma.sh` returns
403), so `prisma generate` / `prisma migrate deploy` / a full `next build`
could not be executed here. The schema change is a hand-authored migration
(the repo's own established pattern for this exact constraint — see
`prisma/migrations/20260901000000_.../migration.sql` and
`20260909000000_.../migration.sql` for prior precedent) and `tsc --noEmit`
confirms the **only** remaining type errors are the direct, expected
consequence of the stale generated Prisma client (it doesn't yet know about
the two new nullable columns) — not a defect in the code. See §15 for exact
commands run and their real output.

## 2. Initial GDPR audit findings

Module 38 ("GDPR Compliance") had already built a real, correctly-designed
*read-only* half of GDPR erasure:

- `gdpr-privacy-rules.ts` — a domain service classifying 12 data categories
  into `HARD_DELETE` / `ANONYMIZE` / `RETAIN`, with GDPR Art. 17(3) rationale
  for each.
- `gdpr-data-inventory.ts` + `PrepareAccountDeletionUseCase` — walks every
  repository holding user data and produces a deletion **plan/report**.
- `ExportPersonalDataUseCase` (Art. 20 portability) — fully executable and
  correct as-is; out of this module's scope.
- `Consent`/`ConsentRepository` — grant/withdraw, audited. Correct as-is.

But `PrepareAccountDeletionUseCase`'s own doc comment states explicitly:
*"Never performs an irreversible delete or mutates any data... a support/admin
workflow (out of this module's scope) would review before actually executing
a deletion."* That execution step never existed. Concretely:

- No code path anonymized, minimized, or hard-deleted a single row.
- `User.deletedAt` + `status: DEACTIVATED` (`softDeleteAccount`, used by the
  self-service "Delete my account" flow) only *deactivated* the account —
  name/email/phone/passwordHash/image were left untouched, indefinitely.
- Verification documents (`ProfessionalVerificationDocument.fileUrl`,
  pointing at Cloudinary `type: "private"` assets) had a DB `removeDocument`
  hard-delete but **no storage-deletion port existed at all** — a removed
  document's row disappeared while its file stayed in Cloudinary forever.
- No repository exposed a bulk "erase this user's PII" operation on
  `Address`, `CustomerProfile`, `ProfessionalProfile`, or `Notification`.
- Neither `PrepareAccountDeletionUseCase` nor `ExportPersonalDataUseCase` nor
  any other GDPR use case was wired to a route or Server Action — the entire
  module was reachable only from its own tests.
- `requireAuth()` (rbac.ts) never re-validates account status against the
  database — only `requireRole()`'s admin-tier branch does (a deliberate,
  documented Module 82 trade-off). Combined with the JWT session strategy,
  nothing would have stopped an erased user's still-valid JWT from
  continuing to pass ordinary `requireAuth()` checks.
- Financial models (`Invoice`, `CreditNote`, `Payment`, `Transaction`,
  `Commission`, `Payout`) were never touched by module 38 in any direction —
  correctly, since they are RETAIN-classified and legally require the
  recipient's legal name/tax ID (Spanish invoicing law), but there was no
  code anywhere asserting or testing that an erasure operation *couldn't*
  reach them.

## 3. Exact root causes

1. `PrepareAccountDeletionUseCase` was deliberately read-only by design
   (Module 38's own scope), and nothing in a later module ever built the
   execution step it was designed to precede.
2. No storage-deletion port/adapter existed for verification documents —
   only an upload-side `VerificationDocumentUploadService`.
3. No repository method existed to anonymize `User`/`Address`/
   `CustomerProfile`/`ProfessionalProfile` fields in bulk, or to hard-delete
   a user's `Notification` rows.
4. No idempotency marker existed to distinguish "deactivated" (existing
   `deletedAt`/`DEACTIVATED`, already reused by the self-service delete flow
   for an unrelated purpose) from "GDPR-erased" — reusing `deletedAt` alone
   would have made a second erasure attempt indistinguishable from a first.
5. No GDPR use case was ever wired into a reachable entry point.

## 4. Implemented changes

**New use case** — `ExecuteAccountErasureUseCase`
(`src/core/application/use-cases/gdpr/execute-account-erasure.use-case.ts`):
the actual execution step, completing Module 38's plan/execute split. Applies
exactly the classification `gdpr-privacy-rules.ts` already decided:
anonymizes `User` (never hard-deletes the row — see §5), `Address`,
`CustomerProfile.notes`, `ProfessionalProfile`'s PII fields; hard-deletes
auth credentials (sessions, OAuth links, refresh/verification/reset tokens)
and `Notification` rows; soft-deletes + retryably purges verification
documents from Cloudinary; never touches any RETAIN category (no repository
for `Job`/`Invoice`/`Dispute`/`AuditLog`/`Consent` is even injected into it —
see `GdprErasureRepos`'s own doc comment for why that's a structural
guarantee, not just a runtime choice).

**New domain event** — `AccountErasureExecuted`
(`src/core/domain/events/account-erasure-executed.ts`) + its audit-log
subscriber `RecordAccountErasureExecutedAuditLogSubscriber`, mirroring the
existing `AccountDeletionRequested`/`RecordAccountDeletionRequestedAuditLog
Subscriber` pattern. New `AdminAuditAction` value `GDPR_DELETION_EXECUTED`.

**New storage port + adapter** — `VerificationDocumentStorageDeleter`
(`src/core/application/interfaces/verification-document-storage-deleter.ts`)
and `CloudinaryVerificationDocumentDeletionService`
(`src/core/infrastructure/storage/cloudinary/verification-document-deletion-service.ts`),
mirroring the existing upload-side service's own conventions exactly (same
client, same `type: "private"` delivery). Recovers Cloudinary's
`public_id`/`resource_type` from the stored `fileUrl` since neither is
persisted anywhere on `ProfessionalVerificationDocument`.

**Extended repository interfaces + Prisma implementations** (narrow, one
method each, matching the codebase's existing "narrow module-scoped
interface" convention):
- `UserRepository`: `getErasureState`, `eraseAccount` (atomic
  compare-and-set via `WHERE personalDataErasedAt IS NULL`),
  `invalidateAllSessions` (hard-deletes NextAuth `Session`/`Account` rows).
- `AddressRepository.eraseForUser`, `CustomerProfileRepository.eraseForUser`,
  `NotificationRepository.deleteAllForUser`.
- `ProfessionalVerificationRepository`: `eraseDocumentsForProfessionalProfile`,
  `listDocumentsPendingStoragePurge`, `markDocumentStoragePurged`.
- `ProfessionalRepository` needed **no** interface change — its existing
  `update(id, data)` already accepts every PII field that needs clearing.

**Wiring** — `gdpr/compose.ts` exports `makeExecuteAccountErasureUseCase()`.
`profile/compose.ts` now composes it into `DeleteAccountUseCase`, which was
rewired to delegate its actual work to it (see §5 for why this is the app's
one real, already-UI-reachable erasure trigger).

## 5. Erasure lifecycle

Matches the brief's four states, reusing what the domain already modeled
rather than inventing new ones:

1. **Active** — `User.status = ACTIVE`, `personalDataErasedAt = null`.
2. **Erasure requested** — unchanged from Module 38:
   `PrepareAccountDeletionUseCase` publishes `AccountDeletionRequested`
   (`GDPR_DELETION_REQUESTED` audit entry).
3. **Erasure executed** — this module's new state:
   `ExecuteAccountErasureUseCase` runs, `User.personalDataErasedAt` is
   stamped, `AccountErasureExecuted` is published
   (`GDPR_DELETION_EXECUTED` audit entry). The `User` row is **never**
   hard-deleted — every table referencing a user does so via an
   `onDelete: Restrict` or `SetNull` foreign key (Message, Review,
   CompanyMember, Job, Invoice, Dispute, ...), specifically so those rows
   keep resolving to *something* after the person leaves. Anonymizing the
   one shared `User` row therefore anonymizes every one of those joins for
   free — no separate write to Message/Review/CompanyMember was needed.
4. **Retained legal/financial records** — `Job`/`Payment`/`Commission`/
   `Payout`/`Invoice`/`CreditNote`/`Transaction`/`Dispute`/`SupportTicket`/
   `AuditLog`/`Consent`: never touched. `ExecuteAccountErasureUseCase`
   structurally cannot reach them — `GdprErasureRepos` injects no repository
   for any of them.

**Real, reachable trigger.** Module 38's own use cases (export, prepare) were
never wired to any route — that convention is unchanged here for those two.
But this module's execution use case *is* wired to a real, already-live,
UI-reachable entry point: `DeleteAccountUseCase`
(`src/app/(dashboard)/profile/actions.ts` → `deleteAccountAction`, the
dashboard's existing "Delete my account" flow). That flow previously only
called `softDeleteAccount` (deactivate) + `revokeAllRefreshTokensForUser`; it
now delegates to `ExecuteAccountErasureUseCase` after the same password
confirmation, so "delete my account" now performs real GDPR erasure rather
than a bare deactivation. No second, parallel "are you sure" UI was added.

## 6. Data classification (applied, not just planned)

| Category | Strategy | What actually happens |
|---|---|---|
| AUTH_CREDENTIALS | HARD_DELETE | `Session`, `Account` (OAuth), `RefreshToken`, `EmailVerificationToken`, `PasswordResetToken` rows deleted/revoked. `User.passwordHash` cleared. |
| PROFILE_DATA | ANONYMIZE | `User.name/email/phone/image/emailVerified` replaced with pseudonymous placeholders; `Address` line1/line2/city/postalCode/label/lat/long cleared; `CustomerProfile.notes` cleared. |
| MARKETPLACE_ACTIVITY | ANONYMIZE | No direct write — `ServiceRequest`/`Quote`/`Appointment` display the now-anonymized `User`/`CustomerProfile` via their existing FKs. |
| MARKETPLACE_FINANCIAL | RETAIN | `Job` and everything financially attached to it: untouched, unreachable by this use case. |
| MESSAGES | ANONYMIZE | No direct write — `Message.senderId` is `onDelete: Restrict`; content stays for the other participant, the sender's *name* is what's now anonymized (at the `User` row). |
| REVIEWS | ANONYMIZE | Same mechanism — `Review.reviewerId` is `onDelete: Restrict`. |
| NOTIFICATIONS | HARD_DELETE | All `Notification` rows for the user deleted. |
| DISPUTES_AND_SUPPORT | RETAIN | Untouched, unreachable. |
| VERIFICATION_DOCUMENTS | HARD_DELETE | `ProfessionalVerificationDocument` rows soft-deleted immediately, then their Cloudinary files purged (retryable — see §7). |
| AUDIT_LOG | RETAIN | Untouched, unreachable — this module's own new audit entries are the only additions. |
| CONSENT_RECORDS | RETAIN | Untouched, unreachable. |
| COMPANY_MEMBERSHIP | ANONYMIZE | No direct write — `CompanyMember.userId` FK; the member's identity is whatever the now-anonymized `User` row shows. |

## 7. Document-retention behavior

- Metadata: `ProfessionalVerificationDocument` (Prisma model, Module 17).
  Files: Cloudinary, `type: "private"`, uploaded by
  `CloudinaryVerificationDocumentUploadService`.
- Before this module: DB deletion existed (`removeDocument`); storage
  deletion did not exist at all (confirmed no `destroy` call anywhere in the
  codebase before this change).
- Now: erasure soft-deletes every not-yet-deleted document for the user's
  professional profile (`deletedAt` — new column) inside the same call that
  anonymizes the account, then — **outside** that step, never rolled back by
  a storage failure — attempts to purge each one's Cloudinary file via the
  new `CloudinaryVerificationDocumentDeletionService`. A confirmed purge sets
  `storagePurgedAt` (new column). A document can be `deletedAt`-set with
  `storagePurgedAt` still null (storage failed or hasn't run) — that state is
  the explicit signal for "retry", never presented as fully purged.
  `ProfessionalVerificationRepository.listDocumentsPendingStoragePurge`
  re-selects exactly those on every subsequent erasure call, so a transient
  Cloudinary outage self-heals on the user's next login/erasure retry (or a
  future scheduled retry job, not built here — see §16).
- The legacy `VerificationDocument` Prisma model (distinct from
  `ProfessionalVerificationDocument`) has zero application code writing to
  it anywhere in the repo (confirmed by search) — it is inert, pre-existing
  dead schema, out of scope here as it holds no live data to erase.
- `CompanyVerificationDocument` (company-side verification) is **not**
  covered — Module 38's own `GdprInventoryRepos` never included company
  verification either; extending both modules' scope to companies is a
  bigger change (a company's documents may belong to a company an erased
  user merely works for, not owns) and is flagged in §17 rather than
  implemented here.

## 8. Financial/legal-record protection

Enforced structurally, not just by convention: `GdprErasureRepos` (the only
dependency `ExecuteAccountErasureUseCase` can act through) does not include
`JobRepository`, a payments/invoicing repository, `DisputeRepository`,
`AdminAuditLogRepository` (write side), or `ConsentRepository`. There is no
code path inside this use case that can mutate a `Job`, `Payment`, `Invoice`,
`CreditNote`, `Transaction`, `Commission`, `Payout`, `Dispute`, or
`SupportTicket` row. Test: *"never mutates financial records (Job) it has no
repository access to"* seeds a `Job` for the erased professional and asserts
byte-for-byte equality before/after erasure.

Invoice-specific note: `Invoice.recipientLegalName`/`issuerLegalName`/
`issuerTaxId`/`recipientTaxId` are direct, legally-required snapshot fields
(Spanish e-invoicing/tax retention), not derived from `User` — they are
correctly never touched, by construction (no code path reaches them).

## 9. Authentication behavior after erasure

- **Credentials login**: blocked outright. `passwordHash` is cleared, and
  `authorize()` in `auth-config.ts` already rejects any user with no
  `passwordHash` before ever comparing a password.
- **OAuth login**: `Session`/`Account` rows are hard-deleted
  (`invalidateAllSessions`), so a future OAuth sign-in cannot silently
  resume the identity via the existing linked account (and cannot re-link by
  email either, since the email is now a pseudonymous placeholder).
- **RefreshToken-based clients**: revoked (`revokeAllRefreshTokensForUser`,
  reused as-is from `AuthTokenRepository`).
- **Admin-tier actions**: fully protected the instant erasure runs —
  `requireRole()` (rbac.ts) already re-checks `status === "ACTIVE"` against
  the database on every admin-tier call, and erasure sets `status` to
  `DEACTIVATED`.
- **Known, explicitly documented limitation**: this app's cookie session
  strategy is `"jwt"` (not `"database"` — a pre-existing, load-bearing
  choice required by the Credentials provider, see `auth-config.ts`'s own
  doc comment). An *already-issued* JWT is not server-revocable; for
  ordinary (non-admin-tier) requests it stays valid, per `requireAuth()`,
  until it naturally expires (up to 30 days with "remember me"). This is the
  exact same trade-off `requireRole()` already documents and accepts for
  admin-tier freshness — extending a per-request DB check to every ordinary
  request platform-wide was judged (consistent with that existing precedent
  and this module's scope-discipline instruction against a "general security
  rewrite") too large a blast-radius change for this module. Documented here
  rather than silently left unaddressed — see §16.

## 10. Audit/security behavior

- `GDPR_DELETION_EXECUTED` audit entries are written on **every** call,
  including a no-op idempotent replay (`metadata.alreadyErased: true`) —
  the trail shows every time erasure was invoked, not just the one that did
  work.
- Metadata is deliberately minimal: `alreadyErased` (bool),
  `categoriesProcessed` (category → strategy-name map, e.g.
  `"PROFILE_DATA": "ANONYMIZE"`), `documentsStoragePurgeFailures` (count).
  No name/email/phone/address ever appears in an audit entry — verified by
  a test asserting the serialized metadata never contains the seeded user's
  email or name.
- Authorization: `ExecuteAccountErasureUseCase.execute` takes an explicit
  `actor: { userId, isAdmin }` and throws `UnauthorizedError` when
  `actor.userId !== userId && !actor.isAdmin` — a non-admin cannot execute
  another user's erasure. `isAdmin` must come from a fresh
  `requireRole()`-style check at the call site (never a possibly-stale JWT
  claim alone), matching this codebase's existing "authorization resolved at
  the edge, use case trusts its typed input" convention.

## 11. Idempotency/concurrency behavior

- `UserRepository.eraseAccount` is a single atomic
  `updateMany({ where: { id, personalDataErasedAt: null }, ... })` —
  reports how many rows it actually touched. Two concurrent calls for the
  same user converge on exactly one anonymizing write; the loser is treated
  identically to "already erased." Verified by a concurrency test running
  two `execute()` calls via `Promise.all` and asserting exactly one
  `alreadyErased: false` / one `alreadyErased: true`.
- Every other write (`Address`/`CustomerProfile`/`Notification`/document
  soft-delete) is a `WHERE ... IS NULL`-guarded bulk update — naturally
  idempotent, safe to re-run.
- The document-storage purge retry is independent of the anonymization
  idempotency check — it re-runs (and re-selects only outstanding rows) on
  every call, including a replay, so a prior partial failure always gets
  retried. Verified by a dedicated test: first call simulates a storage
  failure (`documentsStoragePurgeFailures: 1`, DB row stays soft-deleted but
  not storage-purged); second call succeeds without re-soft-deleting the
  already-deleted row.

## 12. Database/schema changes

Two purely additive, nullable columns (migration
`prisma/migrations/20260910000000_add_gdpr_erasure_execution/migration.sql`,
hand-authored — see §1):

- `users.personalDataErasedAt TIMESTAMP(3) NULL` + index. The erasure
  idempotency guard, deliberately distinct from the pre-existing
  `deletedAt` (which the self-service delete flow already set for an
  unrelated "deactivated" meaning).
- `professional_verification_documents.deletedAt TIMESTAMP(3) NULL` and
  `.storagePurgedAt TIMESTAMP(3) NULL` + index on `deletedAt`. No existing
  row is rewritten; every pre-existing document defaults to
  "not yet erased," which is correct.

No table renamed, no column dropped, no data migration needed.

## 13. Files changed

New:
- `prisma/migrations/20260910000000_add_gdpr_erasure_execution/migration.sql`
- `src/core/domain/events/account-erasure-executed.ts`
- `src/core/application/interfaces/verification-document-storage-deleter.ts`
- `src/core/application/use-cases/gdpr/execute-account-erasure.use-case.ts`
- `src/core/application/use-cases/gdpr/record-account-erasure-executed-audit-log.subscriber.ts`
- `src/core/infrastructure/storage/cloudinary/verification-document-deletion-service.ts`
- `tests/integration/gdpr/gdpr-erasure-execution.test.ts`

Modified (production code):
- `prisma/schema.prisma`
- `src/core/domain/repositories/{user,address,customer-profile,notification,professional-verification,admin-audit-log}-repository.ts`
- `src/core/infrastructure/database/prisma/repositories/prisma-{user,address,customer-profile,notification,professional-verification,admin-audit-log}-repository.ts`
- `src/core/application/use-cases/gdpr/compose.ts`
- `src/core/application/use-cases/profile/{compose,delete-account.use-case}.ts`

Modified (tests — mechanical fake updates to satisfy widened interfaces,
plus the two real DeleteAccountUseCase-signature call-site updates):
- `tests/integration/{auth,gdpr,company,profile,quotes,notification,verification,service-request,analytics,sms}/fakes.ts` (or inline test-file fakes for `professional/onboarding-flows.test.ts`, `sms/sms-dispatch-pipeline.test.ts`)
- `tests/unit/core/application/use-cases/{stripe-connect,payments,onboarding}/fakes.ts`, `tests/unit/core/application/use-cases/notification/notify-dispute-created-sms.subscriber.test.ts`
- `tests/integration/profile/profile-flows.test.ts` (DeleteAccountUseCase construction updated to the new 2-arg signature + a real `ExecuteAccountErasureUseCase`)

## 14. Tests added/updated

`tests/integration/gdpr/gdpr-erasure-execution.test.ts` (new, 12 tests):
NotFoundError for unknown user; UnauthorizedError for a non-admin acting on
someone else; admin-actor success; account anonymization + credential
blocking; address/customer-profile erasure + token/session revocation;
notification hard-delete + professional PII clearing (non-PII fields
survive); document soft-delete + storage purge; storage-failure retry;
idempotent replay; concurrent-execution convergence; financial-record
non-mutation; minimal PII-free audit entry + event publication.

`tests/integration/profile/profile-flows.test.ts` (existing
`DeleteAccountUseCase` suite, all 4 tests kept and passing): now exercises
the real `ExecuteAccountErasureUseCase` end-to-end instead of a bare
`softDeleteAccount` stub.

Every fake implementing a widened interface (`UserRepository`,
`AddressRepository`, `CustomerProfileRepository`, `NotificationRepository`,
`ProfessionalVerificationRepository`) across the whole test tree was updated
with a correctly-behaved (not just type-satisfying) stub — see §15 for the
full list of suites re-run to confirm no regression.

## 15. Validation results

Every command below was actually executed in this sandbox; output is
summarized honestly, including the one command class that could not
complete.

- **`npx eslint <changed files>`** — PASS, 0 errors/warnings, exit code 0.
- **`npx eslint .`** (whole repo) — PASS, 0 errors/warnings.
- **`git diff --check`** — PASS, exit code 0 (no whitespace errors).
- **`npx tsc --noEmit`** — 8 errors, **all** of them
  `Property 'X' does not exist` for `personalDataErasedAt` /
  `deletedAt`/`storagePurgedAt` on `ProfessionalVerificationDocument` — i.e.
  exactly, and only, the two new columns this migration adds, because the
  generated Prisma client in this sandbox is stale (see §1). Two real bugs
  this same run caught and that were fixed before this final result: a
  file-editing mistake that had accidentally deleted the pre-existing
  `updatePreferredLocale` method from `UserRepository`, and a missing
  `override` modifier on an `Error` subclass's `cause` parameter property.
  Both fixed; the final 8 remaining errors are Prisma-staleness only.
- **`npm test` / `npx vitest run`**: the full suite could not complete
  within this sandbox's 180-second command limit (confirmed by two separate
  timeouts on `tests/unit` and `tests/integration` in full). Ran in
  scoped batches instead, covering every file this module touched plus
  adjacent domains:
  - `tests/integration/gdpr` — **21/21 passed** (9 pre-existing Module 38 +
    12 new Module 88).
  - `tests/integration/{profile,auth,company}` — **46/46 passed**.
  - `tests/integration/{professional,quotes,notification,verification,service-request,analytics}` — **190/190 passed** (2 unrelated, pre-existing `PrismaClientInitializationError` background warnings from tests that opportunistically touch the real Prisma client — same darwin-vs-linux engine mismatch as §1, not caused by this change, and did not fail any test).
  - `tests/unit/core/application/use-cases/{stripe-connect,payments,onboarding}` — **129/129 passed**.
  - `tests/integration/{financial,dispute,dispute-resolution,job,jobs,booking,chat}` — **277/277 passed** (1 more of the same pre-existing Prisma-engine background warning, no test failure).
  - **Total actually observed passing: 663/663**, 0 failures, across every
    suite run.
  - Not run in this session (time-boxed out, not because of a known
    failure): `tests/unit`'s remaining directories and
    `tests/integration/{admin,affiliate,backup,cache,config,database,
    discovery,feature-flags,geolocation,health,i18n,materials,
    multi-instance-safety,observability,payments,performance,portfolio,
    realtime,referral,review,search,security,sms(remainder),
    trust-integrity,workflow-expiration}`. An exhaustive search
    (`grep -rl "implements UserRepository\|AddressRepository\|
    CustomerProfileRepository\|NotificationRepository\|
    ProfessionalVerificationRepository"`) across the entire `src`+`tests`
    tree found and updated every fake affected by this module's interface
    changes, so no known reason exists for these to fail — but they were
    not directly observed passing in this session.
- **`npx next build`** — did not complete within the 180-second command
  limit either time it was attempted; would in any case hit the same
  Prisma-engine network restriction as `prisma generate` (the build process
  needs a working query engine to type-generate/prerender). Not verified.
- **`npx prisma migrate status` / `npx prisma generate`** — could not run:
  both require downloading engine binaries from `binaries.prisma.sh`, which
  returns `403 Forbidden` in this sandbox (confirmed on repeated attempts,
  with and without `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1`). No cached
  `linux-arm64` engine exists locally (a `darwin-arm64` one does, from a
  prior run on the actual Mac this device shell mounts into, but this
  shell's own Linux VM needs a different target). **Action required from
  you**: run `npx prisma generate && npx prisma migrate dev` (or
  `migrate deploy` against a real database) once from an environment with
  network access to Prisma's CDN, to regenerate the client and apply the
  hand-authored migration — the same follow-up every prior hand-authored
  migration in this repo already calls for.

## 16. Known limitations

- **JWT session staleness** (§9): an erased user's already-issued session
  cookie remains valid for ordinary requests until its natural expiry (up to
  30 days), by the same trade-off `requireRole()` already documents for
  admin-tier freshness. Every credential-based or OAuth-based *new*
  sign-in, and every admin-tier action, is fully blocked immediately.
- **No scheduled retry job** for outstanding document-storage purges: a
  document stuck at `deletedAt` set / `storagePurgedAt` null (a persistent
  Cloudinary outage, not just a transient one) only gets retried the next
  time that same user's erasure is executed again — which, since erasure is
  now idempotent and safe to re-invoke, could be triggered by re-running
  `deleteAccountAction`, but nothing does so automatically today. A small
  cron/background job iterating `listDocumentsPendingStoragePurge` across
  all professional profiles would close this; not built here as it's a new
  scheduled-job concept, judged out of this module's "smallest complete
  architecture" scope.
- **`CompanyVerificationDocument` / company-side verification** is not
  covered by erasure (see §7) — Module 38's own inventory never covered it
  either.
- Neither `PrepareAccountDeletionUseCase` nor `ExportPersonalDataUseCase`
  gained a route/Server Action in this module (unchanged from Module 38) —
  only the execution use case was wired to a real entry point, since that
  is what "actually executable end-to-end" required at minimum.
- This module does not itself constitute a legal compliance certification —
  it makes the erasure mechanism real, correct, and tested against the
  classification the codebase already committed to; whether that
  classification and its retention periods satisfy Spanish/EU law for this
  specific business is a legal question outside an engineering module's
  scope, and no retention *period* (e.g. "keep invoices N years") was
  invented here beyond what already existed in the repository.

## 17. Out-of-scope findings for Modules 87/90

- `requireAuth()` has no database-freshness re-check for ordinary
  (non-admin-tier) requests at all — a pre-existing Module 82 trade-off,
  not introduced by this module, but worth a dedicated look if the platform
  ever needs faster-than-JWT-expiry revocation for suspensions/bans too
  (not just erasure).
- `CompanyVerificationDocument`/company verification has no GDPR
  inventory, plan, or erasure coverage at all — a natural follow-up to
  Module 38+88's user-side work, scoped separately since a company's data
  isn't solely one person's.
- No scheduled/background retry mechanism exists anywhere in the codebase's
  GDPR modules for any kind of "retry an outstanding external side effect"
  — the pattern this module introduces (`listDocumentsPendingStoragePurge`)
  is currently only re-driven by a fresh erasure call, not a cron.
