# Module 59 — Professional Verification (Persona)

## Purpose & Scope

Adds provider-driven, automated identity verification (KYC) to the Module 17
Professional Verification workflow, with Persona as the first provider —
**not** a second, parallel verification system. A professional may now reach
the same `ProfessionalVerification` case's `PENDING` state either by uploading
documents for manual admin review (Module 17, unchanged) or by completing a
hosted Persona check (document + selfie + liveness), and the resulting
decision — `APPROVED`/`REJECTED`/`UNDER_REVIEW` — is applied through the exact
same state machine `professional-verification-rules.ts` already defines.

In scope: a provider abstraction (`VerificationProvider`), a Persona adapter,
provider-linkage columns on the existing case aggregate, four new use cases
(start/refresh/synchronize an automated check, and payout eligibility), a
webhook-signature-verification method ready for a future webhook route, and a
CLI readiness report.

Out of scope (deliberately, see "Remaining limitations" below): webhook
*processing* (an HTTP route that calls `webhookValidation` and applies the
result), Stripe Connect itself (doesn't exist yet in this codebase), and any
change to the Module 17 manual review UI/flow.

## Why this extends Module 17 instead of introducing a new system

The module brief's own suggested entities — `ProfessionalVerification`,
`VerificationDocument`, `VerificationAttempt`, `VerificationEvent`,
`VerificationStatus`, `VerificationFailureReason`, `VerificationProvider`,
`VerificationAudit` — are, with one exception, concepts Module 17 already
built: `ProfessionalVerification` (the case aggregate),
`ProfessionalVerificationDocument`, `ProfessionalVerificationStatus`, and an
append-only `AuditLog`-backed trail via `AdminAuditLogRepository`. Building a
second copy of all of that under new names would mean two systems that both
decide "is this professional verified," which is precisely the kind of
architectural problem this module's own instructions say to avoid introducing.
So Module 59 is implemented as an **extension**:

- `VerificationAttempt` — not a new table. A provider verification *is* the
  case's own current `PENDING`/`UNDER_REVIEW` occupancy; there is at most one
  in-flight provider attempt per case at a time (the same "at most one active
  case" invariant Module 17 already enforces), so the case row's own
  `provider`/`providerVerificationId`/`providerStatus`/`providerSyncedAt`
  columns *are* the attempt record.
- `VerificationEvent` — not a new table. Every provider-driven state change
  (sync, approve, reject) is recorded on the existing `AuditLog` via
  `AdminAuditLogRepository`, the same trail Module 17's admin actions already
  write to.
- `VerificationFailureReason` — not a new enum. A rejection's `rejectionReason`
  free-text column already exists on `ProfessionalVerification`; a
  provider-reported failure reason is written there identically to a
  human reviewer's.
- `VerificationProvider` — the one genuinely new abstraction this module adds
  (see below).
- `VerificationStatus` — the module brief's status vocabulary
  (`NOT_STARTED`/`PENDING`/`IN_PROGRESS`/`UNDER_REVIEW`/`VERIFIED`/`REJECTED`/
  `EXPIRED`/`MANUAL_REVIEW`) is not a new persisted enum; it is a *provider
  outcome* vocabulary (`ProviderVerificationOutcome`,
  `domain/services/verification-provider-outcome.ts`) that maps onto the
  existing `ProfessionalVerificationStatusValue` enum
  (`DRAFT`→`NOT_STARTED`, `VERIFIED`→`APPROVED`, `NEEDS_REVIEW`→`UNDER_REVIEW`
  ≈ `MANUAL_REVIEW`, etc.) rather than living beside it.

The Module 17 manual document-upload/admin-review use cases
(`Create`/`Submit`/`Resubmit`/`Upload`/`RemoveDocument`/`Approve`/`Reject`/
`RequestResubmission`/`StartReview`/`Get*`/`List*`) are **completely
unmodified** by this module and never import anything from it.

## Architecture

- **Domain**
  - `domain/services/professional-verification-rules.ts` — extended (not
    rewritten) with `VERIFICATION_PROVIDER_VALUES`, `canStartProviderVerification`,
    `canSyncProviderStatus`, and `canReceivePayouts`. Every pre-existing
    export/rule is untouched.
  - `domain/services/verification-provider-outcome.ts` — new. Pure mapping
    from a provider's normalized outcome to a case status, validated through
    the existing `canTransition`.
  - `domain/errors/domain-error.ts` — gains `VerificationProviderError`
    (provider/network failures), following the file's existing per-module
    error convention.
- **Application**
  - `application/ports/verification-provider.ts` — new. The
    provider-agnostic port (`createVerification`/`getVerification`/
    `refreshStatus`/`generateVerificationLink`/`webhookValidation`), modeled
    directly on `application/ports/payment-gateway.ts`'s own "no vendor type
    leaks past this file" contract.
  - `domain/repositories/professional-verification-repository.ts` — extended:
    `ProfessionalVerificationRecord`/`UpdateVerificationStatusData` gain
    `provider`/`providerVerificationId`/`providerStatus`/`providerSyncedAt`;
    two new read methods, `findByProviderVerificationId` and `findSyncable`.
  - `application/use-cases/verification/`:
    - `start-professional-verification.use-case.ts` — `StartProfessionalVerificationUseCase`
    - `refresh-verification-status.use-case.ts` — `RefreshVerificationStatusUseCase`
      (also implements "CompleteVerification"/"RejectVerification"/the
      provider side of "ExpireVerification" from the brief — see that file's
      own doc comment for why they aren't three separate classes)
    - `synchronize-verification.use-case.ts` — `SynchronizeVerificationUseCase`
    - `check-payout-eligibility.use-case.ts` — `CheckPayoutEligibilityUseCase`
      (implements "BlockPayoutWhenNotVerified" / `canReceivePayouts()`)
  - `application/dto/verification.dto.ts` — gains `startProviderVerificationSchema`.
- **Infrastructure**
  - `infrastructure/verification/persona-client.ts` — `fetch`-based HTTP
    client: retry with exponential backoff + jitter (reuses
    `infrastructure/jobs/backoff.ts`), `AbortController` timeout, a
    `Persona-Request-Id` correlation header, structured logging via the
    shared `logger`.
  - `infrastructure/verification/persona-verification-provider.ts` — the
    `VerificationProvider` implementation; the only file that knows Persona's
    JSON:API shape.
  - `infrastructure/verification/null-verification-provider.ts` — the
    `MANUAL` implementation, wired whenever no automated provider is
    configured.
  - `infrastructure/verification/verification-provider-factory.ts` — chooses
    between them from `env.VERIFICATION_PROVIDER`, memoized, same shape as
    `search-provider-factory.ts`/`geocoding-provider-factory.ts`.
  - `infrastructure/config/env.ts` — gains `VERIFICATION_PROVIDER`,
    `PERSONA_API_KEY`, `PERSONA_TEMPLATE_ID`, `PERSONA_WEBHOOK_SECRET`,
    `PERSONA_API_BASE_URL`, plus a production `.superRefine` check requiring
    credentials when `VERIFICATION_PROVIDER=persona`.
  - `infrastructure/database/prisma/repositories/prisma-professional-verification-repository.ts` —
    extended with the new columns/methods.
  - `infrastructure/verification/verification-report-generator.ts` +
    `scripts/run-verification-report.ts` — the `npm run verification-report`
    CLI.

## Database Changes

New migration:
`prisma/migrations/20260816000000_add_professional_verification_provider/migration.sql`
(no existing migration was edited; hand-authored for the same reason every
migration since Module 21 in this repository is hand-authored — no
Postgres/Prisma-engine network access in the sandbox this was built in to run
`prisma migrate dev` and generate it from a real diff).

Purely additive to the existing `professional_verifications` table:

- New enum `VerificationProviderName`: `MANUAL`, `PERSONA`.
- New columns: `provider` (`VerificationProviderName`, default `MANUAL`),
  `providerVerificationId` (`VARCHAR(191)`, nullable), `providerStatus`
  (`TEXT`, nullable), `providerSyncedAt` (`TIMESTAMP`, nullable).
- New index `(provider, providerVerificationId)`.

No table is created, renamed, or dropped. Every existing row defaults to
`provider = MANUAL` with the three new columns `NULL` — this migration changes
no observable behavior for any existing case, and Module 17's own migration/
model doc comments are unmodified.

## Provider Abstraction

```ts
interface VerificationProvider {
  readonly name: "MANUAL" | "PERSONA";
  createVerification(request): Promise<StartVerificationResult>;
  getVerification(providerVerificationId): Promise<VerificationStatusResult>;
  refreshStatus(providerVerificationId): Promise<VerificationStatusResult>;
  generateVerificationLink(providerVerificationId): Promise<string>;
  webhookValidation(rawBody, signatureHeader): WebhookValidationResult;
}
```

No Persona type, HTTP detail, or JSON:API shape appears anywhere outside
`persona-client.ts`/`persona-verification-provider.ts`. Adding a second real
provider later means one more infrastructure adapter implementing this same
interface and one more `case` in `verification-provider-factory.ts` — no
domain or application code changes.

`createVerificationProvider()` returns `NullVerificationProvider` (name
`"MANUAL"`) whenever `VERIFICATION_PROVIDER` is unset, `manual`, or `persona`
without credentials configured — the Module 17 manual workflow never depends
on this port at all, so an unconfigured/misconfigured provider degrades to
"automated verification unavailable," never a broken deployment.

## Verification Lifecycle & Status Mapping

The case state machine itself is unchanged (see
`docs/MODULE_17_PROFESSIONAL_VERIFICATION.md`'s own diagram). What's new is a
second front door into it:

```
DRAFT/REJECTED/RESUBMISSION_REQUIRED
  --StartProfessionalVerificationUseCase-->
    provider.createVerification()
    --> PENDING (provider = PERSONA, providerVerificationId set)

PENDING/UNDER_REVIEW
  --RefreshVerificationStatusUseCase / SynchronizeVerificationUseCase-->
    provider.refreshStatus()
    --> outcome mapped + canTransition-checked -->
        APPROVED | REJECTED | UNDER_REVIEW | EXPIRED | (no change)
```

`ProviderVerificationOutcome` (module-brief vocabulary) → case status
(`mapProviderOutcomeToCaseStatus`):

| Provider outcome | Case status | Notes |
| --- | --- | --- |
| `NOT_STARTED` | *(no change)* | No provider verification exists yet. |
| `PENDING`, `IN_PROGRESS` | *(no change)* | Still running; a no-op sync. |
| `NEEDS_REVIEW` | `UNDER_REVIEW` | Persona flagged it; an admin looks next. |
| `VERIFIED` | `APPROVED` | Also sets `expiresAt`, the public `VERIFIED` badge. |
| `REJECTED` | `REJECTED` | Also sets `rejectionReason` from the provider's own reason if given. |
| `EXPIRED` | `EXPIRED` | Persona's own inquiry TTL; no public badge change (matches `ExpireProfessionalVerificationsUseCase`'s own scope boundary). |
| `ERROR` | *(no change)* | Transient provider/network failure — never a verdict. |

Every mapped status is still re-validated through the existing `canTransition`
before being written — a provider outcome that would produce an illegal
transition (e.g. a stale observation after an admin already independently
decided the case) is silently ignored, never force-applied.

`RefreshVerificationStatusUseCase` deliberately does **not** raise
`ProfessionalVerificationStatusChanged` (Module 37's event). That event's
`actorUserId: string` is non-null by design — every existing transition it
describes has a human actor (the professional or an admin). A provider-driven
transition has none, which is exactly the situation
`ExpireProfessionalVerificationsUseCase` already established a pattern for:
write the `AuditLog` entry and best-effort notification directly, each
independently try/caught so a failure in either never rolls back the
already-committed status change. `RefreshVerificationStatusUseCase` mirrors
that pattern rather than widening the event's contract or its two
subscribers' exhaustive `transition` switches for a case they were never
designed to describe.

`StartProfessionalVerificationUseCase`, by contrast, **does** publish
`ProfessionalVerificationStatusChanged` (`"SUBMITTED"`/`"RESUBMITTED"`) —
starting a Persona inquiry is the professional's own action (a real actor,
`userId`), semantically identical to a manual submit/resubmit, so it reuses
that event and its existing subscribers unmodified.

## Payout Integration (future Stripe Connect)

```ts
canReceivePayouts(status: ProfessionalVerificationStatusValue): boolean // APPROVED only
```

`CheckPayoutEligibilityUseCase.execute(professionalProfileId)` is the
concrete, callable form of the brief's `professional.canReceivePayouts()` and
`BlockPayoutWhenNotVerified`. It depends only on
`ProfessionalVerificationRepository` — never on `VerificationProvider`, Persona,
or any provider detail — so a future Stripe Connect payout module can depend
on this one use case and stay completely ignorant of how verification was
performed, the same one-directional dependency
`application/ports/payment-gateway.ts` already documents in the other
direction (financial code must not know about Persona; verification code must
not know about Stripe).

## Security & GDPR

- **Data minimization**: only `providerVerificationId` (an opaque Persona
  inquiry id), `providerStatus` (a raw status string, for observability), and
  `providerSyncedAt` are persisted. No document image, extracted document
  field (name, DOB, document number, address), or selfie image is ever
  requested or stored by this platform — Persona's own hosted flow collects
  those directly from the professional and retains them in Persona's systems.
- **Secrets**: `PERSONA_API_KEY`/`PERSONA_WEBHOOK_SECRET` are read only from
  the validated `env` singleton, never logged — `persona-client.ts` logs
  method/path/status/correlation id, never headers or bodies, and the shared
  `logger`'s key-pattern redaction is a second line of defense.
  `VERIFICATION_PROVIDER=persona` without credentials fails startup in
  production (`env.ts`'s `.superRefine`), never silently runs unauthenticated.
- **Webhook authenticity**: `PersonaVerificationProvider.webhookValidation`
  verifies Persona's HMAC-SHA256 signature (`Persona-Signature: t=...,v1=...`)
  with a constant-time (`timingSafeEqual`) comparison before trusting any
  payload — implemented and unit-tested now, even though no route calls it
  yet (see "Webhook preparation" below).
- **Least privilege / access to `providerVerificationId`**: exposed through
  the exact same repository methods/use cases Module 17 already scoped to the
  owning professional or an ADMIN/SUPER_ADMIN — no new read path was added.
- **Future deletion requests (GDPR Article 17)**: because no PII beyond an
  opaque provider id is stored here, honoring a deletion request for this
  module's own data is a single-column clear
  (`providerVerificationId`/`providerStatus`/`providerSyncedAt` → `null`) on
  the case row — it does not require deleting the case's audit trail (an
  audit record of "a verification decision was made on this date" is itself
  the kind of compliance record GDPR expects to survive an erasure request,
  the same reasoning Module 38's own GDPR module already applies to
  `AuditLog`). Actually wiring this into `application/use-cases/gdpr/` is not
  part of this module — see "Remaining limitations".

## Webhook preparation

Per this module's explicit instructions, only the *abstraction* is built:
`VerificationProvider.webhookValidation(rawBody, signatureHeader)` verifies a
signature and parses a normalized outcome, entirely synchronously and without
touching the repository. No Next.js Route Handler calls it yet, and no
`ProfessionalVerificationRepository` write happens from a webhook today —
every status change in this module is pulled (`refreshStatus`, on demand or
via the batch `SynchronizeVerificationUseCase`), never pushed. Wiring an
actual `POST /api/webhooks/persona` route is future work: it would call
`webhookValidation`, look up the case via
`findByProviderVerificationId`, and apply the result through the same
`resolveProviderStatusTransition` helper `RefreshVerificationStatusUseCase`
already uses — no new domain logic required when that lands.

## Reporting

`npm run verification-report` — `scripts/run-verification-report.ts` — writes
`reports/professional-verification-report.md` and `.json`: supported
providers (active/configured), case status distribution + count awaiting
provider sync (best-effort — degrades to "unavailable" if the database can't
be reached, never fails the run), security checks, architecture validation,
and integration readiness (whether a real provider/webhook route/payout
consumer is actually wired up yet — informational only, never counted against
the production-readiness score, since manual-only is itself a fully valid
production configuration).

## Testing

- Domain: `verification-provider-outcome.test.ts` (outcome→status mapping +
  transition validation); `professional-verification-rules.test.ts` extended
  with `canReceivePayouts`/`canStartProviderVerification`/`canSyncProviderStatus`.
- Infrastructure: `persona-client.test.ts` (retry/timeout/error-translation,
  mocked `fetch`), `persona-verification-provider.test.ts` (status mapping,
  webhook signature verification, tamper rejection), `null-verification-provider.test.ts`,
  `verification-provider-factory.test.ts` (env-driven selection + fallback),
  `verification-report-generator.test.ts`.
- Application/integration: `tests/integration/verification/provider-verification-flows.test.ts`
  — `Start`/`Refresh`/`Synchronize`/`CheckPayoutEligibility` against real
  domain rules with fake repositories/provider, including a batch-sync
  per-case-failure test and an event-publishing assertion for `Start`.
- The existing Module 17 fakes (`tests/integration/verification/fakes.ts`,
  `tests/integration/gdpr/fakes.ts`) were extended with the new
  provider fields/methods — no existing test in either suite needed to
  change its assertions.

## Validation Results

Run in this sandbox (no live Postgres/Prisma-engine network access — see
`docs/MODULE_21_DISPUTES_SUPPORT.md`'s own "Validation Results" for the
identical, previously-documented constraint):

- `npm run typecheck` — clean **except** two files that reference the four
  new Prisma columns/enum this migration adds
  (`prisma-professional-verification-repository.ts`,
  `scripts/run-verification-report.ts`). These fail only because
  `node_modules/.prisma/client` in this sandbox was generated from the
  pre-Module-59 schema and `npx prisma generate` cannot reach
  `binaries.prisma.sh` here (`403 Forbidden` — no network egress to that
  host in this environment). Every other file in this module, and the rest
  of the codebase, typechecks clean. Running `npx prisma generate` (or
  `npx prisma migrate dev`) on a machine with normal network access
  regenerates the client and resolves both errors — no code change needed.
- `npm run lint` — clean, 0 errors, 0 warnings across every file this module
  touched.
- `npm test` — every test this module added passes (unit + integration, 60+
  new test cases across 9 new/extended files); the pre-existing Module 17/
  GDPR/workflow-expiration/admin suites were re-run and still pass unchanged.
  One unrelated, pre-existing, already-documented `PrismaClientInitializationError`
  (darwin-arm64-generated engine vs. this sandbox's linux-arm64 runtime)
  surfaces as a background unhandled rejection during the admin compose test
  — it does not fail any test and is identical to the condition
  `scripts/run-capacity-report.ts`'s own doc comment already describes.
- `npm run verification-report` — runs successfully end to end, including
  the same Prisma-engine limitation degrading gracefully (statistics report
  as "unavailable" rather than crashing the CLI); both report files are
  written. Getting the CLI to load `.env` at all required adding
  `--env-file-if-exists=.env` to its npm script — see that script's own doc
  comment for why (ES import hoisting means loading `.env` from inside the
  script itself always runs too late).

## Remaining Limitations

- **Webhook processing is not wired up.** `webhookValidation` is implemented
  and tested; no Route Handler calls it. Real-time push updates therefore
  don't exist yet — only pull (`refreshStatus`/`SynchronizeVerificationUseCase`).
- **No scheduled cron for `SynchronizeVerificationUseCase`.** It exists and is
  composed (`makeSynchronizeVerificationUseCase`) but nothing calls it on a
  timer yet — the same shape `RunWorkflowExpirationsUseCase`'s daily cron
  established for Module 28 would need to be replicated for this use case, or
  the future webhook route could supersede the need for polling entirely.
- **`CheckPayoutEligibilityUseCase` reports `"NOT_STARTED"` for a
  professional whose only case history is EXPIRED**, rather than
  `"EXPIRED"` — `findActiveByProfessionalProfileId` excludes EXPIRED cases by
  design (see that method's own doc comment). Blocking behavior is correct
  either way (`eligible: false`); only the label is imprecise. Documented in
  `check-payout-eligibility.use-case.ts` rather than widening the repository
  interface for a cosmetic distinction.
- **GDPR erasure for `providerVerificationId`/`providerStatus`/`providerSyncedAt`
  is not wired into `application/use-cases/gdpr/`.** The data is minimal
  enough that clearing it is a single-column update (see "Security & GDPR"
  above), but no `DeletePersonalDataUseCase`-style use case does so yet.
- **Persona field mapping in `createVerification` is a best-effort split of
  a single `fullName` string into first/last name** (`fullName.split(" ")`).
  Real-world compound Spanish surnames (e.g. "García López") will usually
  split correctly under this heuristic, but it is not a substitute for
  capturing first/last name as separate fields at the account level — a
  follow-up module could add that instead of relying on this split.
- **No admin-facing UI/Server Action for the provider-driven flow was
  built** (only the use cases + `compose.ts` wiring) — the module brief
  scoped this as an architecture/backend module; the existing Module 17
  professional/admin pages are unmodified and still show/act on the manual
  flow only.
