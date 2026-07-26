# Module 24 — Security & Anti-Abuse

## Purpose

This module hardens the marketplace against automated and human abuse
that Modules 01–23 did not already address: brute-force/credential-
stuffing logins, registration floods, password-reset floods, account
enumeration, spam service requests/quotes/messages/reviews, and
unauthorized or excessive admin actions. It adds a reusable, configurable
rate-limiting abstraction, a centralized anti-abuse policy layer, an
append-only security event log, and a temporary/auto-expiring account
restriction primitive — then wires the highest-risk, highest-frequency
existing flows through them.

It deliberately does **not**: implement Stripe/payment integration
(Module 12 doesn't exist yet), redesign Module 22's commission/financial
logic, add ML-based fraud scoring, or stand up a distributed
(multi-instance) rate-limit backend (deferred to Module 25 — Production
Infrastructure; see "Deferred to Module 25" below).

## Threat model

| # | Threat | Status |
|---|---|---|
| A | Brute-force/credential-stuffing login, repeated failed auth | **Addressed** — `LOGIN_BY_EMAIL`/`LOGIN_BY_IP` rate limits + auto-escalating temporary account block |
| A | Password reset flooding | **Addressed** — `PASSWORD_RESET_REQUEST_BY_EMAIL`/`BY_IP` |
| A | Verification email flooding | **Policy defined** (`EMAIL_VERIFICATION_RESEND_BY_USER`) — no resend flow exists in the codebase yet to wire it to (see "Known limitations") |
| A | Account enumeration | **Already addressed pre-module** (RequestPasswordResetUseCase, RegisterUserUseCase's error messages) — audited, not re-implemented; this module adds rate-limiting that itself never reveals account existence (see "Account enumeration protection") |
| B | Mass account creation / registration abuse | **Addressed** — `REGISTRATION_BY_IP` |
| C | Spam service requests | **Addressed** — `SERVICE_REQUEST_CREATE_BY_USER` |
| C | Duplicate/quote spam | **Addressed** — `QUOTE_CREATE_BY_USER` + pre-existing per-request duplicate-quote rejection in `CreateQuoteUseCase` |
| C | Cancellation/rebooking abuse | **Not separately addressed** — audited (`CancelServiceRequestUseCase`, Job cancellation state machine in `job-state.ts`); no realistic amplification path found beyond what `SERVICE_REQUEST_CREATE_BY_USER` already bounds (a cancelled request doesn't let a customer create requests faster). Flagged as a candidate for future refinement, not implemented now. |
| D | Message spam / harassment patterns | **Addressed** — `MESSAGE_SEND_BY_USER` + duplicate-content/min-interval primitives (`spam-detection.ts`) available for a conversation-aware follow-up (see "Known limitations") |
| E | Review spam, review bombing, self-review, multi-account targeting | Self-review and duplicate review are **already structurally impossible** (`Review.jobId` is unique, `CreateReviewUseCase` requires the caller to be that job's customer). This module adds **`REVIEW_CREATE_BY_USER`** as the remaining frequency guard. Multi-account review bombing is out of scope (would require identity-linking heuristics beyond this module's deterministic, non-ML scope). |
| F | Repeated suspicious payment/refund attempts | Module 12 (Payment/Stripe) doesn't exist. What's observable today is Module 22's `FinancialAdjustment`, which **already has** a DB-level `idempotencyKey` (see `prisma/schema.prisma`, `financial_adjustments` table, added in Module 22). This module adds a *frequency* policy, `FINANCIAL_ADJUSTMENT_CREATE_BY_USER`, defined for forward compatibility — **not yet wired to a Server Action**, because no Server Action calls `CreateFinancialAdjustmentUseCase` today (audited: it's currently only reachable from dispute-resolution application code, not a client-facing action) |
| G | Unauthorized admin access / privilege escalation | **Addressed** — every admin-only security action requires `requireRole(SUPER_ADMIN)`, stricter than the ADMIN/SUPER_ADMIN gate most other admin actions use |
| G | Suspicious admin actions | **Addressed** — `ADMIN_ACTION` SecurityEvent recorded on restriction create/lift |

## Security architecture

```
Server Action / Route Handler
        │
        ├─ requireAuth() / requireRole()   (existing, reused — infrastructure/auth/rbac.ts)
        │
        ├─ AntiAbuseService                (application/services/anti-abuse-service.ts)
        │     ├─ RateLimitRepository       (domain interface)
        │     │     └─ InMemoryRateLimitRepository (infrastructure/security)
        │     ├─ SecurityEventRepository   (domain interface)
        │     │     └─ PrismaSecurityEventRepository
        │     └─ AccountRestrictionRepository (domain interface)
        │           └─ PrismaAccountRestrictionRepository
        │
        └─ existing use case (unchanged)
```

`AntiAbuseService` is the single seam every Server Action goes through —
it depends only on domain repository *interfaces*, never Prisma or
Stripe directly, matching this codebase's existing layering (see
`src/core/domain/repositories/README.md`'s conventions, already followed
by every other module). No existing use case's constructor signature was
changed; enforcement happens at the Server Action boundary, the same
place `requireAuth()`/Zod validation already happen.

## Rate limiting

`domain/repositories/rate-limit-repository.ts` defines the
`RateLimitRepository` interface (`consume(key, limit, windowMs, now)` →
`{ allowed, limit, remaining, retryAfterMs }`). The window/decision math
is pure and unit-tested independently in
`domain/services/rate-limit-window.ts` (`computeRateLimit`) — fixed-window
algorithm, not sliding-window/token-bucket (a deliberate, documented
simplicity trade-off; see that file's own doc comment).

`infrastructure/security/in-memory-rate-limit-repository.ts` is the only
implementation wired up today, backed by a plain in-process `Map`. This
codebase has no Redis/cache dependency (checked `package.json` — none),
so this is both the dev/test implementation *and* what production runs on
today. See "Deferred to Module 25" for the multi-instance implication.

All policies (limit + window) live in one place,
`application/ports/rate-limit-policies.ts` — no magic numbers scattered
across call sites:

| Policy | Limit | Window |
|---|---|---|
| `LOGIN_BY_EMAIL` | 5 | 15 min |
| `LOGIN_BY_IP` | 20 | 15 min |
| `PASSWORD_RESET_REQUEST_BY_EMAIL` | 3 | 1 hour |
| `PASSWORD_RESET_REQUEST_BY_IP` | 10 | 1 hour |
| `EMAIL_VERIFICATION_RESEND_BY_USER` | 3 | 1 hour |
| `REGISTRATION_BY_IP` | 5 | 1 hour |
| `SERVICE_REQUEST_CREATE_BY_USER` | 10 | 1 hour |
| `QUOTE_CREATE_BY_USER` | 30 | 1 hour |
| `MESSAGE_SEND_BY_USER` | 60 | 10 min |
| `REVIEW_CREATE_BY_USER` | 10 | 1 hour |
| `FINANCIAL_ADJUSTMENT_CREATE_BY_USER` | 20 | 1 hour |

Read-only requests (listing/searching/viewing) are never rate-limited.

Keys are built by `domain/services/security-key.ts`'s
`buildRateLimitKey(policyName, { userId?, ipHash?, resource? })` —
policy name is always the first segment (no cross-policy collisions even
for the same user/IP), and at least one identifying part is required
(the function throws otherwise, preventing an accidental shared/unbounded
key).

## Anti-abuse policy layer

`application/services/anti-abuse-service.ts`'s `AntiAbuseService` is the
centralized "is this allowed" layer:

- `enforceRateLimit(policyName, identity, onBlockedEventType)` — throws
  `RateLimitedError` (a new `DomainError` subclass, `code:
  "RATE_LIMITED"`, carries `retryAfterMs` — safe to show the client;
  never exposes the underlying limit/window/count) and records a
  `SecurityEvent` **only on the blocked attempt**, never on an allowed
  one.
- `assertNotBlocked(userId)` — throws `AccountRestrictedError` (new
  `DomainError` subclass, generic message) if the user has an active
  `TEMPORARILY_BLOCKED` restriction. `THROTTLED`/`FLAGGED` are
  intentionally *not* hard-blocked here.
- `escalateToTemporaryBlock(userId, { reason, durationMs })` — creates a
  short, auto-expiring `TEMPORARILY_BLOCKED` restriction
  (`createdByUserId: null` — system-created, never permanent) and
  records `ACCOUNT_TEMPORARILY_BLOCKED`. Used today only by the login
  flow (5 failed logins in 15 min → 30-minute account lock, on top of the
  rate limit itself).
- `isDuplicateContent(candidate, recentHistory)` /
  `isBelowMinimumInterval(lastActionAt, minIntervalMs)` — thin wrappers
  around the pure `domain/services/spam-detection.ts` functions, exposed
  for a future caller that has recent-content history in hand (see
  "Known limitations" — not yet wired to chat's message history).

## Security events

New `SecurityEvent` Prisma model (append-only, no update/delete method on
its repository interface — same convention as the existing
`AdminAuditLogRepository`). Kept as its own table rather than reusing
`AuditLog`: most of these events (a failed login for an unknown email, an
anonymous rate-limit trip) have no authenticated actor and no single
target entity, which `AuditLog`'s actor/entity-centric shape assumes (see
`schema.prisma`'s doc comment for the full reasoning).

Implemented event types (a deliberate subset of the spec's list — only
what this module's actual wiring emits):

`LOGIN_FAILED`, `LOGIN_SUCCEEDED`, `ACCOUNT_CREATED`,
`PASSWORD_RESET_REQUESTED`, `PASSWORD_RESET_COMPLETED`,
`RATE_LIMIT_TRIGGERED`, `ACCOUNT_TEMPORARILY_BLOCKED`,
`SERVICE_REQUEST_RATE_LIMITED`, `QUOTE_RATE_LIMITED`,
`MESSAGE_RATE_LIMITED`, `REVIEW_RATE_LIMITED`, `ADMIN_ACTION`.

`EMAIL_VERIFICATION_REQUESTED`, `SUSPICIOUS_ACTIVITY_DETECTED`, and
`SECURITY_POLICY_BLOCKED` are defined in the enum/type (forward
compatibility with the spec's full vocabulary and with
`AntiAbuseService`'s generic `enforceRateLimit`/`recordEvent` signatures)
but not currently emitted anywhere — no email-resend flow exists yet, and
no caller currently needs a "soft flag, don't block" event distinct from
the rate-limit ones.

Read access is `SUPER_ADMIN`-only
(`use-cases/security/list-security-events.use-case.ts`, gated at the
Server Action boundary in `app/(dashboard)/admin/security/actions.ts` —
stricter than the ADMIN/SUPER_ADMIN gate most other admin actions use,
since these events can carry account-enumeration-relevant detail like
login timing). The admin DTO (`application/dto/security.dto.ts`) never
exposes `ipHash` even to an authorized admin — see "Privacy".

## Idempotency / replay protection

Audited Modules 08 (Quote), 10 (Booking/Appointment), 11 (Job), 21
(Dispute), 22 (Commission/Financial) for duplicate-action risk:

- **Quote**: `CreateQuoteUseCase` already rejects a second *active* quote
  by the same professional on the same service request
  (`ConflictError`) — pre-existing, reused, not duplicated.
- **Review**: `Review.jobId` is `@unique` at the DB level and
  `CreateReviewUseCase` already throws `ConflictError` on a second
  review for the same job — pre-existing, structural.
- **FinancialAdjustment** (Module 22): already has a DB-level
  `idempotencyKey` column — pre-existing, not duplicated.
- **Appointment/Job**: audited; no client-supplied idempotency key or
  double-submit risk found beyond what existing state machines
  (`appointment-state.ts`, `job-state.ts`) already guard via status
  transitions.

This module's own contribution here is the *frequency* layer
(rate-limiting) on top of these existing *uniqueness* guarantees — the
two are complementary, not overlapping: uniqueness stops a rapid
double-click from creating two records for the *same* thing; rate
limiting stops a burst of *different* things.

## Spam controls

- **Service requests, quotes, messages, reviews**: per-user rate limits
  (see table above) enforced at the Server Action boundary in
  `requests/actions.ts`, `dashboard/professional/quotes/actions.ts`,
  `messages/actions.ts`, `reviews/actions.ts`.
- **Duplicate-content detection** (`domain/services/spam-detection.ts`,
  `isDuplicateContent`) and **minimum-interval detection**
  (`isBelowMinimumInterval`) are implemented, unit-tested, and exposed
  through `AntiAbuseService`, but **not yet wired into
  `SendMessageUseCase`/chat's Server Action** — doing so correctly
  requires fetching a slice of recent conversation history first, which
  is a `ConversationRepository`/`MessageRepository` read this module
  did not want to bolt on without also deciding retention/perf
  trade-offs. See "Known limitations".
- No ML, no external moderation API — everything here is deterministic
  and unit-testable without a network call, per the module's own
  constraint.

## Account enumeration protection

Audited before writing any new code:

- `RequestPasswordResetUseCase` already never reveals whether an email
  exists (same code path, same timing-insensitive branch, no email sent
  either way) — pre-existing, verified, not modified.
- `RegisterUserUseCase` does throw a distinguishable `ConflictError` for
  an existing email — this is a common, accepted trade-off (a "sign up"
  form telling you an email is taken is standard UX, not a hardenable
  regression) and was left as-is; only the new IP-based rate limit around
  it was added.
- This module's own `forgotPasswordAction` addition is careful to return
  the *same* generic error message whether the rejection came from the
  rate limit or (never, since `RequestPasswordResetUseCase` doesn't
  throw) an "unknown email" case — a rate-limit-specific error message
  distinguishable from a normal failure would have reopened a timing/
  response-shape side channel.

## Authorization hardening

Audited `CreateServiceRequestUseCase`, `CreateQuoteUseCase`,
`SendMessageUseCase`, `CreateReviewUseCase`, `AcceptQuoteUseCase`, and the
Admin/Dispute/Verification module's admin use cases for client-trusted
IDs. Finding: **ownership was already consistently server-derived** in
every use case audited — `userId` always comes from
`requireAuth()`/`requireRole()`, never from client input; a
`conversationId`/`requestId`/`jobId` passed by the client is always
re-verified against the session inside the use case (see e.g.
`SendMessageUseCase`'s and `CreateServiceRequestUseCase`'s own doc
comments, already using exactly this pattern before this module existed).
No concrete authorization bypass was found. This module does not
introduce a second authorization system — `requireAuth()`/`requireRole()`
are reused as-is everywhere, including in the new
`app/(dashboard)/admin/security/actions.ts`.

## Temporary restrictions

New `AccountRestriction` Prisma model — a separate table, not a status
column bolted onto `User` (see `schema.prisma`'s doc comment for the
full reasoning: `User.status` already models the account-lifecycle/
moderation decision; this models a temporary, often-automated overlay).

States: `THROTTLED`, `TEMPORARILY_BLOCKED`, `FLAGGED` (there is no
`ACTIVE` state stored — "no active restriction row" *is* active/normal).
Internal `reason` category (`FAILED_LOGIN_BURST`, `REGISTRATION_ABUSE`,
`SERVICE_REQUEST_SPAM`, `QUOTE_SPAM`, `MESSAGE_SPAM`, `REVIEW_ABUSE`,
`ADMIN_DECISION`, `OTHER`) and free-text `notes` are internal-only —
`application/dto/security.dto.ts`'s admin view is the only place either
is ever read back out, and neither is ever returned from a Server Action
reachable by the restricted user.

No permanent auto-bans: automated restrictions
(`AntiAbuseService.escalateToTemporaryBlock`) always set `expiresAt`.
Only an explicit admin action
(`CreateAccountRestrictionUseCase`, `createdByUserId` set) may create an
indefinite one — enforced both by the use case and, redundantly, by
`PrismaAccountRestrictionRepository.create`/the in-memory test fake
(never trust a single call site to remember a rule that matters).

## Privacy / data minimization

- **No raw IP address is ever persisted.** `hashIp` (`domain/services/
  security-key.ts`) computes a *keyed* SHA-256 hash (`sha256(pepper +
  ":ip:" + rawIp)`) — keyed, not a bare hash, because a bare SHA-256 of
  an IPv4 address is brute-forceable in seconds (only ~4 billion
  possible values). The pepper is `AUTH_SECRET` (an existing server-only
  secret — see `infrastructure/auth/request-context.ts`'s doc comment
  for why no new env var was introduced). This hash is one-way and has
  no legitimate "reverse it back to an IP" use — even the admin DTO
  (`toAdminSecurityEventView`) omits it entirely.
- **User-Agent is truncated** to 200 characters
  (`truncateUserAgent`) before it's ever stored.
- **`SecurityEvent.metadata` must never contain a password, token, or
  raw IP** — documented on the repository interface; every call site in
  this module only ever puts policy names/reason categories in it.
- **No passwords, tokens, or payment credentials are stored anywhere in
  this module.**
- **Client input never controls a rate limit, an abuse score, or a
  restriction state** — every `RateLimitPolicy` is server-side config;
  every `AccountRestriction` is created only by
  `AntiAbuseService`/`CreateAccountRestrictionUseCase`, both of which
  resolve their actor from the session, never from a request body.
- Retention: `SecurityEvent` and `AccountRestriction` rows are not
  automatically purged by this module (no cron/scheduled job exists in
  this codebase to hook into — see "Deferred to Module 25"). A future
  retention job (e.g. delete `SecurityEvent` rows older than 90 days) is
  a natural Module 25 addition.

## Database changes

Additive only — no existing table, column, or enum renamed, dropped, or
altered.

- **`SecurityEvent`** (`security_events` table) + `SecurityEventType`
  enum.
- **`AccountRestriction`** (`account_restrictions` table) +
  `AccountRestrictionState`/`AccountRestrictionReason` enums.
- Two new back-relations on `User`: `securityEvents`,
  `accountRestrictions`/`accountRestrictionsCreated`.

Migration: `prisma/migrations/20260804000000_add_security_anti_abuse_module/migration.sql`,
hand-authored — **this sandbox has no network access to Prisma's engine
binary CDN** (`prisma validate`/`generate`/`migrate` all fail with `403
Forbidden` fetching `binaries.prisma.sh`, confirmed, and not fixable
locally — the environment's own cached engine binaries are for a
different Prisma engine commit than the currently-installed CLI expects,
confirmed via checksum mismatch). This is the exact same, already-
documented limitation as Modules 19/20/21's own migrations (see those
files' migration.sql header comments) — this migration follows the same
hand-authoring process and mirrors what `prisma migrate dev` would
generate for the schema diff above. **Run `npx prisma migrate dev` (or
`prisma migrate deploy` in production) against a real database to confirm
before merging.**

## Testing

Vitest, same conventions as every other module (`tests/unit/core/...` for
pure domain logic, `tests/integration/...` for use-case + fake-repository
flows).

- `tests/unit/core/domain/rate-limit-window.test.ts` — fixed-window
  math: first attempt, limit reached, block, `retryAfterMs` computation,
  window reset, boundary condition, invalid policy config rejection.
- `tests/unit/core/domain/security-key.test.ts` — `hashIp` determinism/
  non-reversibility/pepper-sensitivity, `truncateUserAgent` edge cases,
  `buildRateLimitKey` namespacing (no cross-policy/cross-identity
  collision, throws with no identity), `contentFingerprint`
  normalization.
- `tests/unit/core/domain/spam-detection.test.ts` — duplicate-content
  detection (exact, near-duplicate, no history, no match) and minimum-
  interval detection.
- `tests/unit/core/domain/account-restriction-rules.test.ts` — active/
  expired/lifted restriction logic, severity ordering
  (`TEMPORARILY_BLOCKED` > `THROTTLED` > `FLAGGED`), hard-block
  predicate.
- `tests/unit/core/application/security-dto.test.ts` — **privacy
  regression**: `toAdminSecurityEventView` never includes `ipHash`, even
  in serialized form.
- `tests/integration/security/anti-abuse-flows.test.ts` — real
  `AntiAbuseService` + real `InMemoryRateLimitRepository` + fake
  event/restriction repositories: allow-under-limit, block-over-limit,
  event-recorded-only-on-block, no cross-user/cross-policy bleed (also
  doubles as the "client can't bypass rate limits via a different
  resource id" regression, read the other direction: an unrelated
  identity is never incorrectly blocked), auto-escalation to temporary
  block and its auto-expiry, admin restriction create/lift + `ADMIN_ACTION`
  event recording, admin self-restriction rejection, lifting an unknown
  restriction (`NotFoundError`), and a security regression section
  reusing the established `vi.mock("@/lib/auth")` pattern (see
  `tests/integration/admin/admin-flows.test.ts`) to prove a non-admin/
  regular-ADMIN session cannot pass the `SUPER_ADMIN`-only gate the
  security admin actions use.

## Production deployment considerations

- The in-memory rate limiter is per-process. A single-instance deployment
  (this codebase's current shape) is fine; a multi-instance/serverless
  deployment needs the Redis swap described below before this module's
  limits are trustworthy at scale.
- `AUTH_SECRET` (reused as the IP-hashing pepper) must remain a real
  secret in every environment — it already is, per `infrastructure/
  config/env.ts`.
- This module assumes the app runs behind a reverse proxy/platform that
  sets `x-forwarded-for` (true for Vercel and most standard setups). No
  `middleware.ts` exists in this codebase (confirmed at audit time) — IP
  extraction happens per-Server-Action via `next/headers`, not centrally.

## Known limitations

- The in-memory rate limiter resets on every process restart and is not
  shared across instances (see "Deferred to Module 25").
- Duplicate-content/minimum-interval spam detection
  (`spam-detection.ts`) is implemented and unit-tested but not yet wired
  into `SendMessageUseCase`/chat — needs a decision on how much
  conversation history to fetch per check.
- `EMAIL_VERIFICATION_RESEND_BY_USER` and
  `FINANCIAL_ADJUSTMENT_CREATE_BY_USER` policies are defined but not
  wired to a Server Action, because no such action exists yet in this
  codebase (no resend-verification-email flow; no client-facing
  create-financial-adjustment action).
- Cancellation/rebooking abuse (threat C) has no dedicated control beyond
  the existing state machine and the service-request creation rate
  limit — audited, no concrete amplification path found, but not a
  rigorous proof of absence.
- Multi-account review-bombing/targeting (threat E) is out of scope —
  would require identity-linking heuristics beyond this module's
  deterministic, non-ML design constraint.
- No automatic retention/purge job for `SecurityEvent`/
  `AccountRestriction` rows exists yet.
- The in-memory rate limiter's `Map` read-modify-write is not atomic
  under true concurrent access for the same key — a benign race (see
  that file's own doc comment): it can under-enforce by a small margin
  under heavy concurrent load, never over-enforce/incorrectly block.

## Deferred to Module 25 (Production Infrastructure)

- A Redis-backed (or equivalent) `RateLimitRepository` implementation for
  correct enforcement across multiple app instances — this module's
  `RateLimitRepository` interface and `InMemoryRateLimitRepository` are
  deliberately shaped so this is a drop-in swap at the composition root
  (`application/use-cases/security/compose.ts`) with zero caller changes.
  See `InMemoryRateLimitRepository`'s own doc comment.
  - Distributed/multi-instance also implies the "no permanent auto-bans"
    escalation logic should move from per-process memory to a shared
    store — already the case here (`AccountRestriction` is Prisma-backed,
    not in-memory), so no change needed there.
- A background job (cron/scheduled task) for `SecurityEvent`/
  `AccountRestriction` retention/cleanup — no such job-scheduling
  infrastructure exists in this codebase yet.
- Centralized, structured security logging/alerting (shipping
  `SecurityEvent` rows to an external SIEM/monitoring system) —
  out of scope; this module only persists them to Postgres.

## Deferred to other future modules

- Module 26 (IVA/Tax): not touched, no interaction with this module.
- Module 12 (Payment/Stripe Connect): financial-abuse controls here are
  intentionally limited to what's observable via Module 22's existing
  `FinancialAdjustment`/ledger — a real payment/refund abuse policy needs
  actual payment data this module cannot see yet.
