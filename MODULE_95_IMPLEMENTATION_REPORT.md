# Module 95 — API Security Hardening: IDOR, Authorization & Rate Limiting

## 0. Scope and method note (read this first)

This module asked for an exhaustive, code-level audit of every API route, Server Action,
authenticated mutation, admin/cron/webhook endpoint and sensitive read across a codebase that
already carries 94 prior implementation modules — several of them (16, 17, 18, 21, 24, 25, 38,
44, 56, 70.1, 72, 73, 82, 83, 87, 90, 92, 93, 94) are themselves dedicated security/authorization/
audit modules. Given the size of the codebase (17 API routes, 34 Server Action files, ~60
use-case directories, a dedicated RBAC/rate-limit/security infrastructure layer), a from-scratch
re-verification of literally every code path in one pass is not something that can be honestly
claimed as "100% verified" in a single session — and rule 27 of this module's own brief
explicitly forbids claiming 100% coverage without having actually verified it.

What this report *does* reflect: a real, code-level investigation (not a re-read of prior audit
reports — every claim below was checked against the current source) covering the RBAC core,
rate-limiting infrastructure, all three cron routes, all three webhook routes, the full admin
Server Action surface, company membership/invitation actions, dispute actions, messaging actions,
GDPR use cases, and a mass-assignment sweep across the whole `src/core` tree. Two confirmed,
fixed vulnerabilities came out of that pass (§4). The remaining sections document what was
inspected and found already sound, so a future auditor doesn't have to re-derive it, and are
explicit about what was *not* re-verified line-by-line this pass (§17).

## 1. Endpoint inventory

### 1.1 API Routes (`src/app/api/**/route.ts`) — 17 total

| Route | Method | Auth | Role | Notes |
|---|---|---|---|---|
| `/api/auth/[...nextauth]` | GET/POST | NextAuth internal | PUBLIC | Auth.js handler, not audited here (out of scope — auth-config.ts covered separately) |
| `/api/cron/expire-workflows` | GET | CRON_SECRET bearer | CRON | Fail-closed if unset; **fixed: timing-safe compare (§4.2)** |
| `/api/cron/gdpr-cloudinary-purge` | GET | CRON_SECRET bearer | CRON | Fail-closed if unset; **fixed: timing-safe compare (§4.2)**; no route-level test existed — added (§6) |
| `/api/cron/reconciliation-run` | GET | CRON_SECRET bearer | CRON | Fail-closed if unset; **fixed: timing-safe compare (§4.2)** |
| `/api/health` | GET | none | PUBLIC | Liveness only, no sensitive data — intentional |
| `/api/health/ready` | GET | none | PUBLIC | Readiness only, `checks.*` are booleans, no topology detail — intentional |
| `/api/health/startup` | GET | none | PUBLIC | Same as `/ready` — intentional |
| `/api/health/circuit-breakers` | GET | `requireRole(ADMIN, SUPER_ADMIN)` | ADMIN | Verified present |
| `/api/health/diagnostics` | GET | `requireRole(ADMIN, SUPER_ADMIN)` | ADMIN | Auth runs before any feature-flag/side-effect code (Module 70.1 fix, verified still in place) |
| `/api/analytics/dashboard` | GET, POST | `requireRole(ADMIN, SUPER_ADMIN)` | ADMIN | Both verbs gated |
| `/api/realtime/channels` | GET | session (`getCurrentUser`) | AUTHENTICATED | Scoped inside use case |
| `/api/realtime/presence/[userId]` | GET | session; ownership/staff check inside `GetPresenceUseCase` | AUTHENTICATED/self-or-staff | IDOR surface is the use case, not the route — spot-checked, rejects non-self/non-staff with 403 |
| `/api/realtime/sse` | GET | session | AUTHENTICATED | Stream scoped to caller's own channels |
| `/api/user/language` | POST | session | AUTHENTICATED | Mutates only the caller's own preference row |
| `/api/webhooks/persona` | POST | HMAC-SHA256 + `timingSafeEqual`, replay-window check | WEBHOOK | Verified: signature computed over raw body before any parsing; malformed hex rejected before `timingSafeEqual`; idempotency via `(PERSONA, event.id)` claim |
| `/api/webhooks/stripe` (Connect) | POST | Stripe SDK `constructEvent` | WEBHOOK | Verified: raw body only, generic 401 on any failure reason, idempotency via `(STRIPE, event.id)` |
| `/api/webhooks/stripe-payments` | POST | Stripe SDK `constructEvent` | WEBHOOK | Verified: same pattern, separate secret/route from Connect webhook, idempotency via `(STRIPE_PAYMENTS, event.id)` |

### 1.2 Server Actions (`**/actions.ts`) — 34 files

All 34 were opened and every exported action confirmed to call `requireAuth()` or
`requireRole()` as its first statement before touching input. None were found calling a use
case with a client-supplied actor/admin id — every action derives the caller from the
session (`requireAuth()`/`requireRole()`) and passes that id into the use case, never a
form field. Representative deep-dives (full text reviewed): `admin/actions.ts` (18 actions),
`admin/security/actions.ts`, `admin/company-verifications/actions.ts`,
`dashboard/company/[companyId]/members/actions.ts`,
`dashboard/company/[companyId]/invitations/actions.ts`, `disputes/actions.ts`,
`messages/actions.ts`. Classification:

| Area | Role gate | Ownership enforced in |
|---|---|---|
| `admin/**/actions.ts` (9 files) | `requireRole(ADMIN, SUPER_ADMIN)`, every action | Use case (admin-scoped, no ownership concept) |
| `admin/security/actions.ts` | `requireRole(SUPER_ADMIN)` only | N/A — platform-wide |
| `dashboard/company/**/actions.ts` | `requireAuth()` + `companyId` param | `resolveCompanyActor` inside each use case (re-derives caller's role in that company from DB) |
| `dashboard/professional/**/actions.ts` | `requireAuth()` | Use case resolves caller's own professional profile |
| `disputes/actions.ts`, `messages/actions.ts`, `reviews/actions.ts`, `requests/actions.ts`, `appointments/actions.ts` | `requireAuth()` | Use case re-verifies the caller's relationship to the resource (`resolveDisputeActor`-style pattern), never trusts the id alone |
| `auth/actions.ts`, `auth/logout/actions.ts` | PUBLIC (login/register) / session (logout) | N/A |

### 1.3 Rate limiting coverage

`AntiAbuseService` (`application/use-cases/security/compose.ts`) backs the rate limits found in:
`auth/actions.ts` (login/register throttling), `messages/actions.ts` (message send flood
protection, Module 24 threat D), `requests/actions.ts`, `dashboard/professional/quotes/actions.ts`,
`dashboard/professional/verification/actions.ts`, `dashboard/company/[companyId]/verification/actions.ts`,
`profile/actions.ts`, `reviews/actions.ts`. Backend: Redis-backed in production (`RedisRateLimitRepository`),
in-memory fallback only for non-production — **verified fail-closed**: `rate-limit-repository-factory.ts`
throws at process start if `REDIS_URL` is unset and `isProduction` is true, so an in-memory
limiter can never silently activate in production even if `env.ts`'s own production
`REDIS_URL` requirement is ever weakened. This was inspected as the single highest-value rate-limit
question (§16 of the brief: fail-open vs fail-closed) and the answer is **fail-closed by
construction** for the backend selection; the `InMemoryRateLimitRepository`'s own read-modify-write
race (documented in its source) is called out there as a benign, already-accepted limitation, not
a new finding.

Admin actions (`admin/**/actions.ts`) are not rate-limited. This was evaluated and **accepted as
correct, not a gap**: every one of those actions is already gated by `requireRole()`'s
fresh-DB-read admin check (a demoted/suspended admin is rejected on the very next call), so the
abuse scenario rate limiting exists to prevent (an unauthenticated or low-privilege actor hammering
an endpoint) does not apply — the limiting factor is "how many real admins are calling this," which
is not a rate-limiting problem.

## 2. Authentication / authorization matrix

| Tier | Enforcement mechanism | Verified fresh on every call? |
|---|---|---|
| PUBLIC | none | N/A |
| AUTHENTICATED | `requireAuth()` → session via `auth()` | Session-cookie freshness only (see §17 accepted limitation, inherited from Module 82's own documented trade-off) |
| CUSTOMER / PROFESSIONAL / COMPANY | `requireAuth()` + use-case-level relationship check | Re-derived from DB inside the use case every call — never trusts a role claim for ownership |
| ADMIN / SUPER_ADMIN | `requireRole(ADMIN, SUPER_ADMIN)` / `requireRole(SUPER_ADMIN)` | **Yes** — `requireRole()` re-reads `status` and role keys from the DB on every admin-tier call (Module 82), closing the JWT-staleness window to the very next request after a demotion/suspension |
| CRON | Bearer `CRON_SECRET`, fail-closed if unset | Static secret per deployment; **now timing-safe (§4.2)** |
| WEBHOOK | Provider HMAC signature over raw body | Per-request cryptographic verification, `timingSafeEqual` (Persona) / Stripe SDK `constructEvent` (both Stripe routes) |
| INTERNAL | N/A — no purely internal (non-HTTP-reachable) endpoints found carrying network exposure | — |

## 3. IDOR / privilege-escalation audit — findings

### 3.1 Confirmed and fixed

See §4. Two findings, both fixed with regression tests.

### 3.2 Checked and found sound (no fix needed)

- **ADMIN → SUPER_ADMIN escalation** (`ChangeUserRoleUseCase`): re-verified. Granting
  ADMIN/SUPER_ADMIN to anyone — including self — requires the *caller* to currently hold
  SUPER_ADMIN, re-read fresh from the DB inside the use case itself (not trusted from the
  Server Action's `requireRole()` pass, which only proves "some admin is calling"). A denied
  attempt is recorded as a `SECURITY_POLICY_BLOCKED` SecurityEvent. Removing the platform's last
  active admin is separately blocked (`ConflictError`). This is Module 82's fix (finding B1) —
  verified still in place and unchanged.
- **Company membership actions** (`members/actions.ts`, `invitations/actions.ts`): every action
  takes `companyId` from the URL/argument but the caller's actual role within that company is
  re-resolved server-side (`resolveCompanyActor`, referenced in that use-case family) — a
  client cannot claim OWNER/ADMIN membership by supplying a `companyId` they don't belong to.
- **Dispute actions**: `getDisputeAction`, `addDisputeMessageAction`, `addDisputeEvidenceAction`
  all re-verify the caller's relationship to the dispute inside the composed use case before any
  read/write — confirmed by reading `dispute/compose.ts`'s referenced actor-resolution pattern
  and the actions file's own doc comment, which explicitly states this contract.
- **Messaging** (`messages/actions.ts`): `deleteMessageAction`/`markConversationReadAction` pass
  only the session-derived `user.id` into the use case alongside the client-supplied
  `conversationId`/`messageId` — ownership is the use case's job, never assumed at the action
  layer.
- **Webhooks never trust client-controlled financial state**: confirmed for both Stripe routes —
  every value acted on (PaymentIntent id, connected account id, event type) comes from the
  already-signature-verified Stripe event object, never a request body field parsed before
  verification.
- **Cron routes never accept user-controlled invocation**: confirmed — all three are `GET`
  Route Handlers with no request-body parsing at all; the only "input" is the bearer token,
  which is checked before any use case runs.

## 4. Confirmed vulnerabilities, fixes, and regression tests

### 4.1 IDOR (latent): `ExportPersonalDataUseCase` had no internal authorization check

- **Severity:** HIGH (as a defense-in-depth gap), currently **not exploitable in production**
  because no Server Action or API route calls this use case yet — it exists (Module 38) but is
  unwired.
- **Endpoint / use case:** `ExportPersonalDataUseCase.execute()` (`application/use-cases/gdpr/export-personal-data.use-case.ts`)
- **Attack scenario:** The moment a future Server Action wires this use case to a
  client-reachable call with a client-supplied `userId` (a very plausible next step — "download my
  data" is an obvious feature to add), any authenticated user could pass another user's id and
  receive that user's entire GDPR data inventory: messages, reviews, audit-log entries, consent
  records, service requests, jobs, disputes, support tickets. The use case's old signature —
  `execute(userId: string, actorUserId: string = userId)` — accepted an arbitrary `actorUserId`
  and never compared it to `userId`; the parameter existed only to stamp the audit-log event,
  not to authorize anything.
- **Root cause:** Unlike its sibling `ExecuteAccountErasureUseCase` (which explicitly checks
  `actor.userId !== userId && !actor.isAdmin` and throws `UnauthorizedError`), the export use
  case was written before that pattern was established (Module 38 predates the erasure use
  case) and was never retrofitted.
- **Fix:** Added a typed `ExportPersonalDataActor { userId, isAdmin }` and the same authorization
  check `ExecuteAccountErasureUseCase` uses: `actor.userId !== userId && !actor.isAdmin` →
  `UnauthorizedError`. The actor parameter defaults to `{ userId, isAdmin: false }` (i.e.
  "exporting your own data"), so every existing single-argument call site — including the six
  call sites in `tests/integration/gdpr/gdpr-flows.test.ts` — keeps compiling and passing
  unchanged; this is not a breaking change, it closes the gap for every *future* caller.
- **Regression tests added** (`tests/integration/gdpr/gdpr-flows.test.ts`):
  - `rejects exporting another user's data when the actor is not that user and not an admin`
  - `allows an admin actor to export another user's data`
  - `allows self-export via the default single-argument call`
- **Status:** FIXED, VERIFIED (typecheck + targeted test run pass).

### 4.2 Timing side-channel on `CRON_SECRET` comparison (all 3 cron routes)

- **Severity:** LOW (theoretical remote-timing attack against a long-lived static secret; hard
  to exploit in practice over real network jitter, but a genuine inconsistency with this
  codebase's own established standard).
- **Endpoints:** `/api/cron/expire-workflows`, `/api/cron/gdpr-cloudinary-purge`,
  `/api/cron/reconciliation-run`.
- **Attack scenario:** All three routes compared the `Authorization` header with plain
  JavaScript `!==` string comparison (`authHeader !== \`Bearer ${env.CRON_SECRET}\``), which
  short-circuits at the first differing character. An attacker who can measure response-time
  differences precisely enough (this codebase's own `PersonaVerificationProvider` and the Stripe
  webhook verifiers already treat this exact class of leak as worth defending against for their
  own HMAC comparisons) could in principle recover `CRON_SECRET` character-by-character faster
  than brute force, then trigger the reconciliation/GDPR-purge/workflow-expiration jobs at will
  or starve legitimate cron traffic.
- **Root cause:** The cron routes were written independently of the webhook verifiers and never
  adopted the same `timingSafeEqual` discipline those already use.
- **Fix:** Added `isValidCronAuthHeader()` (`core/infrastructure/auth/cron-auth.ts`) — compares
  UTF-8 byte length first (rejecting on mismatch before ever calling `timingSafeEqual`, which
  throws on unequal-length buffers), then does a constant-time `timingSafeEqual` comparison.
  Wired into all three cron routes, replacing the `!==` check.
- **Regression tests added:**
  - `tests/unit/core/infrastructure/auth/cron-auth.test.ts` — 7 cases (exact match, missing
    header, wrong secret same length, shorter/longer guess, missing `Bearer` prefix,
    case-sensitivity).
  - `tests/unit/app/api/cron/gdpr-cloudinary-purge-route.test.ts` — new route-level test file
    (this cron route had none before this module), including a same-length-wrong-secret case
    that would have passed a naive "compare lengths only" mistake.
  - Existing `expire-workflows-route.test.ts` / `reconciliation-run-route.test.ts` re-run and
    confirmed still passing against the new implementation.
- **Status:** FIXED, VERIFIED.

## 5. Financial security boundary

Reviewed: both Stripe webhook routes, `admin/actions.ts`'s read-only quote/job oversight
actions. No route or action was found accepting a client-supplied `amount`, `commission`,
`payoutAmount`, `status`, or `currency` field that is then persisted without being re-derived
server-side — webhook-driven state transitions (payment captured/failed/refunded) come only from
the already-signature-verified Stripe event, never a request body. A full line-by-line audit of
every use case under `application/use-cases/{payments,financial,invoicing,refunds,stripe-connect,
stripe-disputes,payout}` was **not** completed in this pass (see §17) — the webhook boundary and
the admin oversight surface were the two places a client could plausibly inject a financial
value, and both were clean.

## 6. GDPR security findings

- `ExportPersonalDataUseCase`: see §4.1 (fixed).
- `ExecuteAccountErasureUseCase`: actor-ownership check confirmed already correct
  (`actor.userId !== userId && !actor.isAdmin`).
- `PrepareAccountDeletionUseCase`, `GrantConsentUseCase`, `WithdrawConsentUseCase`: all take a
  single `userId` with no separate actor parameter — reviewed and found to have no client-facing
  entry point today either (same "not yet wired to any Server Action" status as export/erasure
  were before this module — confirmed via the same `grep` sweep that found zero references
  under `src/app` for any GDPR use case except the Cloudinary-purge cron). **Recommendation
  (documented, not implemented — no live surface to fix):** when any of these are wired to a
  Server Action, they should take the same `{ userId, isAdmin }` actor shape and the same
  ownership check as the two use cases already reviewed, for consistency and because — as §4.1
  demonstrated — a use case with no internal check is one refactor away from an IDOR the moment
  someone adds a caller.
- GDPR Cloudinary-purge cron: reviewed under §4.2 (timing-safe fix applied); confirmed it never
  returns personal data, only aggregate counts.

## 7. Trust/fraud (Module 93) and verification (Persona) endpoints

`src/app` has no Server Action or API route that lets a client directly write a fraud signal,
risk score, or verification status — the only externally-reachable entry point into that system
is the Persona webhook (`/api/webhooks/persona`, audited in §1.1/§3.2), which is
signature-verified and only ever carries `externalEventId`/`eventType`/`providerVerificationId`
into `ProcessPersonaWebhookUseCase` — never a status value asserted directly by the caller.
Professional/company verification *decisions* (approve/reject/resubmit) are admin-only
(`requireRole(ADMIN, SUPER_ADMIN)`, verified in `admin/verifications/actions.ts` and
`admin/company-verifications/actions.ts`), and no action lets an applicant approve their own
verification — approval is exclusively an admin action, never one the applicant-facing
`dashboard/professional/verification/actions.ts` / `dashboard/company/[companyId]/verification/actions.ts`
files expose (those files only expose submit/resubmit, not approve).

## 8. Mass assignment

Searched the entire `src/core` tree for `data: input`, `data: { ...body }`, `data: { ...`
spread-into-persistence patterns. **Zero matches.** Every repository write found during this
audit's spot-checks explicitly lists its mutable fields; none was found spreading raw client
input into a Prisma `data:` object.

## 9. Sensitive response data

Spot-checked `admin/security/actions.ts` (explicitly documented as never returning raw
`SecurityEventRecord`/`AccountRestrictionRecord` or an `ipHash`, always mapping through
`toAdminSecurityEventView`/`toAdminAccountRestrictionView`) and the two Stripe webhook routes
(responses contain only `status`/`requestId`, never event payloads). No raw Prisma model
returned directly from a security-sensitive route was found in this pass.

## 10. Error handling

Every route and action reviewed follows the same `fromDomainError`/`toHttpErrorResponse`
convention: a `DomainError` surfaces its own safe message, anything else is logged/reported
server-side and replaced with a generic message. Cron and webhook routes were specifically
checked for whether their 401/503 bodies distinguish failure reasons — confirmed they
deliberately don't (e.g. "Invalid webhook signature." never distinguishes bad signature from
stale timestamp from missing secret).

## 11. Cron endpoint audit — summary

All three cron routes: `CRON_SECRET` required (503 fail-closed if unset), bearer-token check now
timing-safe (§4.2), no user-controlled invocation (GET-only, no body parsing), responses contain
only aggregate counts/outcomes, never per-record financial or personal detail.

## 12. Webhook audit — summary

All three webhook routes: raw-body signature verification before any parsing, idempotency via
`ExternalWebhookEventRepository` claim keyed by `(provider, event.id)`, safe generic error
responses, no trust in any client-supplied status field. No changes needed.

## 13. Rate-limit failure behavior

Fail-closed in production by construction (§1.3) — `createRateLimitRepository()` throws at
first use rather than silently falling back to per-instance in-memory limiting when
`REDIS_URL` is absent and `NODE_ENV` is production. This was a pre-existing Module 82 finding
(H10), re-verified current and unchanged.

## 14. Fixes implemented (summary)

| # | File(s) | Change |
|---|---|---|
| 1 | `src/core/application/use-cases/gdpr/export-personal-data.use-case.ts` | Added `ExportPersonalDataActor` + ownership/admin check (§4.1) |
| 2 | `src/core/infrastructure/auth/cron-auth.ts` (new) | `isValidCronAuthHeader()` — timing-safe bearer comparison |
| 3 | `src/app/api/cron/expire-workflows/route.ts` | Use `isValidCronAuthHeader` |
| 4 | `src/app/api/cron/gdpr-cloudinary-purge/route.ts` | Use `isValidCronAuthHeader` |
| 5 | `src/app/api/cron/reconciliation-run/route.ts` | Use `isValidCronAuthHeader` |

## 15. Regression / new tests added

| File | New/changed | Covers |
|---|---|---|
| `tests/integration/gdpr/gdpr-flows.test.ts` | +3 tests, +1 import, `users` exposed from `setup()` | §4.1 IDOR fix |
| `tests/unit/core/infrastructure/auth/cron-auth.test.ts` (new) | 7 tests | §4.2 timing-safe helper |
| `tests/unit/app/api/cron/gdpr-cloudinary-purge-route.test.ts` (new) | 6 tests | §4.2 fix at the route level; this route had zero test coverage before this module |

All of the above, plus the two pre-existing cron route test files, were run directly against the
changes and pass (33 + 6 tests, 39 total, across 5 files). `tsc --noEmit` and `eslint` were run
against every touched file and pass clean with no new errors or warnings.

## 16. Real PostgreSQL tests

Not added this module. Both confirmed findings (§4) are pure application-logic authorization
checks with no relational-ownership component that would need a real database to prove (the
export-actor check is `actor.userId !== userId`, a plain string comparison; the cron-secret
check has no database involvement at all) — fake-repository/unit tests fully exercise the fixed
logic. Module 91's PostgreSQL integration infrastructure was reviewed as part of the
investigation (`vitest.config.integration-db.ts`, `test:integration:db` script) and remains
available for a future module whose findings do have a relational-ownership dimension.

## 17. What was **not** re-verified this pass (accepted scope limitation)

Given the size of the codebase, the following were reviewed at the "read the file / grep the
pattern" level but not re-derived line-by-line for every one of their internal use cases in this
session, and should not be read as "confirmed clean" with the same confidence as §3–§13 above:

- The full `application/use-cases/{payments,financial,invoicing,refunds,payout,stripe-connect,
  stripe-disputes}` trees beyond the webhook entry points and the admin read-only oversight
  actions (§5).
- The full `application/use-cases/{quotes,booking,job,review,portfolio,onboarding,affiliate,
  referral}` trees beyond the Server Action layer that calls them (§1.2) — every action itself
  was confirmed to gate on `requireAuth()`/`requireRole()` and delegate ownership to the use
  case, but each individual use case's internal ownership check was not independently re-derived
  for all ~60 use-case directories.
- Session/JWT freshness for **non**-admin-tier authenticated actions remains the documented
  Module 82 trade-off (a demoted/suspended ordinary user keeps their session until it naturally
  expires) — re-confirmed as an existing, explicitly-documented, accepted risk, not a new finding.
- `npm run test` (the full suite), `npm run test:integration:db`, and `npm run build` were **not**
  run end-to-end in this session (the full unit+integration suite alone exceeded this session's
  command time budget mid-run); the specific tests touched by this module's changes were run
  directly and pass, `tsc --noEmit` (full project) passes, and `eslint` on every touched file
  passes.

## 18. Production configuration requirements

None. No production credentials were added or required — the two fixes are pure application
logic (an authorization check and a comparison function) with no new environment variables,
external provider configuration, or infrastructure dependency.

## 19. Final Definition of Done — status against the module's own checklist

- API routes inventoried: **done** (§1.1, all 17)
- Server Actions inventoried: **done** (§1.2, all 34 files, every export checked for an
  auth-first call)
- Authentication/authorization requirements documented: **done** (§2)
- IDOR audit completed: **done for the surfaces enumerated in §3**; not exhaustively re-derived
  for every use case in the codebase (§17)
- Horizontal/vertical privilege escalation tested: **spot-verified** (§3.2) — the ADMIN→SUPER_ADMIN
  path was re-derived from source, not merely cited from a prior report
- ADMIN → SUPER_ADMIN escalation blocked: **confirmed still blocked** (§3.2)
- Financial endpoints audited: **partially** — webhook and admin-oversight surfaces only (§5, §17)
- GDPR endpoints audited: **done**, one fix applied (§4.1, §6)
- Trust/fraud endpoints audited: **done** (§7) — no client-writable surface exists
- Persona/verification endpoints audited: **done** (§7)
- Cron endpoints audited: **done**, one fix applied across all three (§4.2, §11)
- Webhooks audited: **done**, no changes needed (§12)
- Rate limiting audited: **done** (§1.3, §13)
- Mass-assignment audit completed: **done**, zero instances found (§8)
- Runtime input validation: reviewed at the Server Action layer (every action Zod-validates
  before calling its use case) — not independently re-verified for every DTO schema
- Sensitive response audit: **spot-checked** (§9), not exhaustive
- Security error leakage reviewed: **done** (§10)
- Regression tests added for both confirmed findings: **done** (§15)
- Real PostgreSQL tests: **not needed for these two findings** (§16)
- Full test suite / build: **not run end-to-end this session** (§17) — targeted tests,
  full-project `tsc --noEmit`, and `eslint` on touched files all pass
- No production credentials added: **confirmed**
- No git add/commit/push performed: **confirmed** (see `git status` below)

## 20. `git status` / `git diff --check`

```
 M src/app/api/cron/expire-workflows/route.ts
 M src/app/api/cron/gdpr-cloudinary-purge/route.ts
 M src/app/api/cron/reconciliation-run/route.ts
 M src/core/application/use-cases/gdpr/export-personal-data.use-case.ts
 M tests/integration/gdpr/gdpr-flows.test.ts
?? src/core/infrastructure/auth/cron-auth.ts
?? tests/unit/app/api/cron/gdpr-cloudinary-purge-route.test.ts
?? tests/unit/core/infrastructure/auth/cron-auth.test.ts
```

`git diff --check` reported no whitespace errors. No commit was made, per this module's git
restrictions.

## 21. Recommendation for the next step

Given the scope note in §0 and §17, before treating this repository as ready for the "final
Production Readiness Audit" the brief describes, it would be worth a dedicated follow-up pass
(could be scoped as its own module, or as part of that final audit) specifically on the
financial (`payments`/`refunds`/`payout`/`stripe-connect`/`stripe-disputes`) and quote/booking
use-case trees — not because anything suspicious was seen there, but because they were the two
largest areas this session did not get to re-derive line-by-line, and they're the highest-value
place for a remaining IDOR to hide in a marketplace platform.
