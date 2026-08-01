# MaestroYa Full Platform Audit

**Scope note on method:** This is a large codebase (2,683-line Prisma schema, 214 use-case files, ~90 test files, a full Clean-Architecture layering with docs per module). Given the size, this audit combined (a) full reads of the schema, middleware, auth config, and RBAC layer, (b) targeted reads of the highest-risk use cases across every module named in the brief (quote acceptance, service-request lifecycle, disputes, company membership, admin actions, commission/financial, chat), (c) repo-wide greps for known risk patterns (dead code, Stripe/IVA coupling, legacy language code, XSS sinks, auth checks on every admin page), and (d) execution of all requested tooling. It is **not** a line-by-line read of all 214 use cases — the architecture is unusually consistent (the same ownership-check idiom repeats everywhere), so sampling across every module was used to establish whether the pattern holds. Areas flagged "sampled, not exhaustive" should get a second pass before the external audit.

**Correction notice (post-publication):** This report originally listed a Critical Finding (#1) claiming every `/admin/*` page relied solely on `middleware.ts` for authorization. That finding was a **false positive**, caused by a failed file-discovery search during the original pass (see the corrected §2 entry below for the full explanation). It has been corrected in place rather than silently removed — the original claim, why it was wrong, and the verification performed are all recorded in §2 for the audit trail.

---

## 1. Executive Summary

**Overall status: CONDITIONALLY READY.**

The codebase is materially more mature than a typical pre-launch audit target. It has a genuine Clean Architecture (domain / application / infrastructure / presentation), consistent ownership-re-derivation on every sampled mutation (never trusts a client-supplied ID), a race-safe quote-acceptance transaction, rate-limited/anti-abuse login, tokens hashed at rest, commission math that matches the spec exactly (7.5%/7.5% on labor only, IVA/Stripe correctly left unimplemented rather than half-built), and per-module documentation that is candid about what's deferred. `tsc --noEmit` and `eslint .` both pass with zero errors.

**Correction:** an earlier version of this report raised a Critical Finding claiming every `/admin/*` page relied solely on `middleware.ts` for authorization. That claim has since been independently re-verified and **corrected: it was a false positive** (see §2). `src/app/(dashboard)/admin/layout.tsx` already independently calls `getCurrentUser()` and redirects any non-`ADMIN`/`SUPER_ADMIN` session before every admin route renders — this has been true since Module 16 was first built, not something added in response to this audit. A regression test (`tests/unit/app/admin-layout-authorization.test.ts`) was added to lock this boundary in place and has been executed on the real development machine: **7/7 tests passed.** There is no remaining Critical finding from this audit.

Beyond that correction, the platform is functionally close to what the module docs claim, with a handful of genuinely orphaned schema states (`DRAFT`, `QUOTED`, `DISPUTED`, `EXPIRED` on `ServiceRequestStatus` — defined, never reachable) and no request-expiry mechanism despite the enum implying one exists. The overall verdict remains "conditionally ready" — now driven by the High-priority environment-verification and service-request-expiry items below, not by any open critical security gap.

---

## 2. Critical Findings

**None remain open.** The one Critical Finding raised by the original pass of this audit has been re-verified and corrected below.

### [FALSE POSITIVE / CORRECTED AUDIT FINDING] "Admin Server Components have no independent authorization — middleware is the only guard"

**Original claim:** The first version of this report stated that all 13 admin list/detail Server Components under `src/app/(dashboard)/admin/*/page.tsx` called their use cases with no independent role check, relying solely on `middleware.ts`'s `ROLE_GATED_PREFIXES` gate for `/admin`.

**Why the original claim was wrong:** The original audit pass searched for an admin-level authorization boundary using a file-discovery pattern that failed to match the Next.js route-group folder `(dashboard)` in the path `src/app/(dashboard)/admin/layout.tsx`, returned "no files found," and incorrectly concluded no such file existed. A follow-up grep across `admin/*/page.tsx` one level deep also never reached the layout file (a different file, one directory up) or any nested `[id]/page.tsx`. The conclusion that admin pages had no independent authorization was therefore based on an incomplete search, not on the actual absence of the check.

**What was actually found on re-verification:** `src/app/(dashboard)/admin/layout.tsx` already wraps every route in the `/admin` tree (confirmed: it is the only `layout.tsx` anywhere under `admin/`, so nothing in that tree can bypass it) and independently calls `getCurrentUser()` — the same session-derived helper used everywhere else in the codebase — before rendering any child route:

```ts
const user = await getCurrentUser();
if (!user) redirect("/auth/login?callbackUrl=/admin");
const isAdmin = user.roles.includes(ROLES.ADMIN) || user.roles.includes(ROLES.SUPER_ADMIN);
if (!isAdmin) redirect("/");
```

Git history confirms this check has existed since the admin panel was first built (`76abdc1 feat(admin): implement Module 16 admin panel`) — it was not added in response to this audit. `middleware.ts`'s `ROLE_GATED_PREFIXES` entry for `/admin` remains in place as an *additional*, earlier-in-the-request-lifecycle layer, not a replacement — i.e. this is genuine two-layer defense-in-depth, not a single point of failure as originally reported. Every admin mutation (`src/app/(dashboard)/admin/actions.ts` and the sibling `security/actions.ts`, `analytics/actions.ts`) was also re-confirmed to independently call `requireRole()`, as the original report correctly noted.

**Remediation performed:** No production code was changed (none was needed). A regression test, `tests/unit/app/admin-layout-authorization.test.ts`, was added to lock this boundary in place against future regression — it mocks `getCurrentUser()`/`next/navigation`'s `redirect()` (the same convention already used by `tests/unit/app/post-login-redirect.test.ts`) and asserts: an unauthenticated visitor is redirected to `/auth/login?callbackUrl=/admin`; a `CUSTOMER`, a `PROVIDER`, and a dual-role (`CUSTOMER`+`PROVIDER`, no admin role) user are each redirected to `/`; and `ADMIN`/`SUPER_ADMIN` sessions render through without any redirect. This test was executed on the real development machine (outside this audit's sandbox, which lacks the native `rollup`/`swc` binaries needed to run Vitest at all): **`npx vitest run tests/unit/app/admin-layout-authorization.test.ts` → Test Files 1 passed (1), Tests 7 passed (7).**

**Status: FIXED — CODE VERIFIED (no code change needed), REGRESSION TEST ADDED AND PASSING (7/7) ON REAL HARDWARE.**

---

## 3. High Priority Findings

### [HIGH] Middleware matcher excludes `/api/*` entirely — all current and future API routes are on their own for auth
**Location:** `middleware.ts:157-159` — `matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"]`.

**Problem:** No middleware-level protection ever applies to `/api/*`. Today this is low-risk — the only API routes are `/api/auth/[...nextauth]` and `/api/health(/ready)`, none of which need role gating. But it means the codebase currently has **zero layered defense** on the API surface: if a future module adds a REST API route (e.g. for a mobile client or a webhook), there is no existing convention/test enforcing that route to call `requireAuth`/`requireRole` itself — the burden falls entirely on the individual route author remembering to do so, with no middleware backstop.

**Why it matters:** This is a process/architecture gap more than an active bug today. The admin route tree's own layout-level check (see the corrected §2 finding) is a good precedent to follow for any future `/api/*` route that needs the same independent, non-middleware-dependent guard — but nothing today enforces that a new route author actually follows it.

**Recommended fix:** Document (in `docs/ARCHITECTURE.md` or similar) that every route under `/api/*` must call `requireAuth`/`requireRole` (or explicitly document why it's public, e.g. health checks and the NextAuth handler), and add a lint rule or test that fails CI if a new `route.ts` under `/api` doesn't reference the auth module.

### [HIGH] No end-to-end verification was possible for CI/build/test in this sandbox
**Location:** N/A — environment.

**Problem:** `npx vitest run` fails immediately (`Cannot find module '@rollup/rollup-linux-arm64-gnu'`), `npx next build` fails immediately (`Failed to load SWC binary for linux/arm64`), and `npx prisma validate`/`migrate status`/`generate` all fail with `403 Forbidden` fetching engine binaries from `binaries.prisma.sh`. All four failures are the same root cause: this sandbox is network-restricted and lacks the `linux-arm64` native optional-dependency binaries for Rollup/SWC/Prisma's engines, and cannot fetch them. `npm install --no-save @next/swc-linux-arm64-gnu` also returned `403 Forbidden` from the registry, confirming it's a sandbox network restriction, not a project misconfiguration (the exact same install works on a normal CI runner or dev machine).

**Why it matters:** This audit could not execute the test suite, could not verify the app actually builds, and could not confirm the live Postgres schema matches `schema.prisma`/migrations. `tsc --noEmit` and `eslint .` (which use pure-JS or already-resolved binaries) *did* run cleanly to completion with zero errors, which is meaningful signal, but it does not substitute for `vitest run`, `next build`, or `prisma migrate status` actually succeeding.

**Recommended fix:** Re-run `npm test`, `npm run build`, and `npx prisma migrate status` in the real target environment (standard x86_64 CI or the project's actual dev machine) before treating this audit's "no test failures found" as equivalent to "tests pass." This is an environment limitation of the audit, not a finding about the code.

### [HIGH] `ServiceRequestStatus` enum has four states with no reachable transition
**Location:** `prisma/schema.prisma` (enum `ServiceRequestStatus`: `DRAFT`, `PUBLISHED`, `QUOTED`, `ACCEPTED`, `IN_PROGRESS`?, `COMPLETED`, `CANCELLED`, `DISPUTED`, `EXPIRED` — exact list per schema); `src/core/domain/services/service-request-state.ts:9-22` explicitly documents that only `PUBLISHED`/`ACCEPTED`/`CANCELLED` are used today, and that `DRAFT`, `QUOTED`, `DISPUTED`, and by implication `EXPIRED` were "added ahead of this module... anticipating a fuller future workflow this module does not implement yet."

**Problem:** A request is created directly into `PUBLISHED` (no draft step), never automatically re-labelled `QUOTED` when a quote arrives, never marked `DISPUTED` when a related dispute opens, and — most notably — **never expires**. There is no scheduled job, no TTL check, no use case that ever writes `EXPIRED`. An indefinitely-open, stale `ServiceRequest` from months ago remains fully "acceptable" (any quote on it can still be accepted) forever, unless a customer manually cancels it.

**Why it matters:** This is exactly the kind of "looks implemented in the schema/enum but isn't backed by logic" gap the audit brief calls out. It's not a bug in the sense of incorrect behavior — the code is internally consistent about only using 3 of the ~8 states — but a business stakeholder skimming the schema would reasonably assume expiry exists. Left alone, real customer requests can go stale indefinitely with no user-facing signal.

**Recommended fix:** Either implement request expiry (a scheduled job or a lazy check-on-read that treats requests older than N days as expired) before launch, or explicitly remove/document the unused enum values as "reserved for a future module" in the schema's own comments (already partially done — extend it to cover `EXPIRED` specifically, since its absence of implementation is more surprising than `DRAFT`/`QUOTED`/`DISPUTED`).

---

## 4. Medium Priority Findings

### [MEDIUM] `console.error` used as the sole failure signal for best-effort side effects (notifications, audit logs)
**Location:** e.g. `src/core/application/use-cases/quotes/accept-quote.use-case.ts:123,127`, `create-dispute.use-case.ts:117,135`, `company-membership/remove-company-member.use-case.ts:62`. Roughly 9 `console.log`/`console.error` call sites total across `src`.

**Problem:** Notification-creation and audit-log-write failures are deliberately swallowed (by design — a failed "quote accepted" notification must not roll back the quote acceptance itself, which is the right call) but the only trace left behind is a `console.error`. In production this depends entirely on whatever log aggregation is wired to stdout/stderr; there's no structured logger call, no alerting hook, no retry/dead-letter queue.

**Why it matters:** Silent notification failures are low severity individually, but audit-log write failures are not — `create-dispute.use-case.ts:108-118` swallows a failed `AuditLog.record()` the same way, and audit logs are exactly the kind of record an external security/compliance audit will expect to be reliable. A `console.error` that scrolls off in production logs is effectively silent.

**Recommended fix:** Route these through the project's own structured logger (the codebase already has `src/core/infrastructure/observability/` — confirm it's used here instead of raw `console`), and consider whether audit-log-write failures specifically deserve a stronger guarantee (e.g. a retry or a dedicated failure queue) given their compliance role.

### [MEDIUM] Dispute creation does not support company-owned jobs' professional side
**Location:** `src/core/application/use-cases/dispute/create-dispute.use-case.ts:26-29`, `resolveRespondentUserIds` at line 147 (professional-raised branch, line 162-170, returns `[]` and is explicitly documented as unreachable today).

**Problem:** `resolveJobActor` (reused from the booking module) cannot currently resolve "the professional side" of a company-owned job as the acting party for dispute creation — the code's own doc comments call this out twice, honestly. Functionally this means: a solo professional can open a dispute against a customer, and a customer can open a dispute against a solo professional or a company, but **a company's professional-side member cannot open a dispute on behalf of the company.**

**Why it matters:** Given companies are a first-class actor in this platform (Module 18), this is a real functional gap for that user segment, not just an edge case — flagged here as the module doc itself flags it, escalated to the report per the audit brief's request to surface UI-vs-backend mismatches.

**Recommended fix:** Extend `resolveJobActor` (or a company-aware sibling) to recognize an active company member of the job's `companyProfileId` as a valid dispute-raising actor, matching how `CreateDisputeUseCase` already resolves company members as *notification recipients* on the other side (line 156-159).

### [MEDIUM] Prisma/build tooling assumes an x86_64 (or pre-cached) environment
**Location:** `package.json` scripts, `Dockerfile`.

**Problem:** As seen in Finding (High) #2, the toolchain's optional native dependencies (Rollup, SWC, Prisma engines) are not vendored/pinned in a way that tolerates an offline or restricted-network ARM environment. This didn't block this audit's static analysis (`tsc`, `eslint`) but did block dynamic verification.

**Why it matters:** If CI or any deployment target ever runs on ARM (increasingly common — Graviton, Apple Silicon CI runners, some container platforms) without unrestricted registry/CDN access, the exact same failures will occur there. Worth confirming the actual CI (`.github/workflows/ci.yml`) and the production `Dockerfile` target a platform where this isn't an issue — it likely already does, since the Dockerfile is presumably x86_64-based, but this wasn't independently verified in this pass.

**Recommended fix:** Confirm CI/production explicitly target `linux/amd64` (or vendor the ARM binaries if ARM deployment is intended), and note this as a known constraint of any future sandboxed/offline audit environment.

---

## 5. Low Priority Findings

### [LOW] No `dangerouslySetInnerHTML` found anywhere in the codebase
Not a bug — a positive finding worth recording as evidence for the security section: zero raw-HTML-injection sinks were found across all `.tsx` files, which meaningfully reduces stored-XSS risk from user-generated content (bios, descriptions, messages, reviews) as long as all of it is rendered as plain React children (the default, auto-escaped path) rather than through this API. No further action needed; recommend keeping a lint rule banning `dangerouslySetInnerHTML` without an explicit sanitizer.

### [LOW] `package.json#prisma` seed config is on a deprecated path
**Location:** `package.json` (`"prisma": { "seed": "tsx prisma/seed.ts" }`), confirmed via the `prisma validate`/`migrate status` warning: *"The configuration property `package.json#prisma` is deprecated and will be removed in Prisma 7. Please migrate to a Prisma config file."*

**Why it matters:** Not a functional bug today (Prisma 6.x still honors it), but it's a known future breakage — migrating to `prisma.config.ts` before upgrading to Prisma 7 avoids a surprise mid-upgrade.

### [LOW] `.env`, `.env.local`, `.env.production` all present locally but correctly gitignored
Verified `.gitignore` excludes all real env files (`.env`, `.env.local`, `.env.production`, etc.). No secrets found committed to the repo in the files inspected. Only `.env.example` (placeholder values expected) should ever be tracked — confirm this stays true going forward, especially around the Stripe/IVA integration work, which will introduce new secret keys.

---

## 6. Security Findings

Separated from ordinary bugs per the brief.

1. **[Corrected — see §2]** Admin read paths were originally reported as lacking independent authorization beyond middleware. Re-verified: `admin/layout.tsx` independently checks `getCurrentUser()`/role on every request across the entire `/admin` tree, in addition to middleware. False positive — no action needed beyond the regression test added.
2. **[High — see §3]** `/api/*` is entirely outside middleware's reach by design (correct for the two current, non-sensitive routes) but sets no enforced convention for future API routes.
3. **Positive:** Login brute-force protection is real and layered — `auth-config.ts:45-79` enforces both email-keyed and IP-keyed rate limits *before* password comparison, auto-escalates repeat failures to a temporary `AccountRestriction`, and deliberately returns the same `null`/generic failure for "rate limited," "wrong password," and "unknown email" so the failure reason isn't leakable to a prober.
4. **Positive:** `EmailVerificationToken`, `PasswordResetToken`, and `RefreshToken` all store only a `tokenHash` (`prisma/schema.prisma:205-262`) — raw tokens are never persisted, and refresh tokens are documented as rotated on every use.
5. **Positive:** Every sampled ownership-sensitive use case (`AcceptQuoteUseCase`, `UpdateServiceRequestUseCase`, `CancelServiceRequestUseCase`, `DeleteMessageUseCase`, `RemoveCompanyMemberUseCase`, `CreateDisputeUseCase`, `GetCompanyForMemberUseCase`) re-derives ownership from the session-authenticated `userId`, never a client-supplied id, and returns an identical `NotFoundError` for "doesn't exist" and "exists but isn't yours" — a deliberate, correctly-applied anti-enumeration pattern seen consistently across modules.
6. **Positive:** `GetProfessionalPublicProfileUseCase` → `PrismaProfessionalDiscoveryRepository.findPublicProfileById` (`prisma-professional-discovery-repository.ts:138-159`) uses an explicit Prisma `select` that only ever returns safe public fields (name, image, business info, city/province) — no email, phone, or internal verification data is exposed on the public professional profile. This is exactly the "accidental PII exposure on a public page" risk the brief called out, and it was not found here.
7. **Positive:** `env.ts` enforces production-only checks (`AUTH_SECRET` length, HTTPS URLs, rejecting `sk_test_`/`pk_test_` Stripe keys in production) via Zod, fails fast at startup, and never logs secret values — only field names — on validation failure.
8. **Not independently verified in this pass (recommend follow-up):** CSRF posture for Server Actions (Next.js's built-in Server Action protections were assumed, not independently re-verified); rate limiting on non-login endpoints (e.g. quote/message spam); file-upload validation for portfolio/verification-document/avatar uploads (Cloudinary-backed — content-type/size validation wasn't traced end to end); SSRF exposure in the geocoding provider's outbound requests.

---

## 7. Broken User Flows

No flow was found to be **broken** in the sense of "throws/crashes/is unreachable" during this pass. What was found instead:

- **Customer: Registration → Login → Request → Quote → Accept → Appointment → Job → Review** — traced through code and appears internally consistent (ownership checks, race-safe acceptance transaction, notification fan-out). **Status: appears COMPLETE**, not independently exercised against a running app/DB in this sandbox (see §13 environment limitations).
- **Professional: Registration → Onboarding → Quote → Accepted Job** — `middleware.ts:119-148` correctly forces any user with `signupIntent === "PROFESSIONAL"` and no `PROVIDER` role back to the onboarding page on every request, including resuming interrupted onboarding — this is a well-built, deliberately-hardened flow. **Status: appears COMPLETE.**
- **Company: professional-side dispute creation** — **Status: PARTIALLY COMPLETE**, see Medium Finding above; the code path exists for customer-initiated disputes against a company but not the reverse.
- **Service request expiry** — **Status: MISSING**, see High Finding above; no flow exists to reach `EXPIRED`.

---

## 8. Missing Functionality

(Excluding Stripe/payment and IVA, which are intentionally deferred per the brief.)

- **Service request expiry** — no scheduled or lazy expiry mechanism, despite the schema anticipating it (§3).
- **Company-initiated disputes** — a company's professional-side member cannot open a dispute against a customer on a company-owned job (§4).
- **Distributed rate limiting** — `env.ts:112-122` documents that `REDIS_URL` is validated but never wired to an actual client; the only rate limiter is in-memory (`infrastructure/security/in-memory-rate-limit-repository.ts`), which is explicitly noted as correct only for a single-instance deployment. If production ever runs more than one app instance, the anti-brute-force protection in Finding (Security) #3 silently stops being effective across instances (each instance has its own independent counters). This should be resolved (Redis-backed limiter) before any horizontally-scaled production deployment, even though it's not a blocker for a single-instance launch.
- **Role-change UI** — `admin/users/page.tsx:14-17` documents that `changeUserRoleAction` exists and is fully wired but has no UI exposing it yet; admins can only suspend/reactivate from the UI today.

---

## 9. Functionality That Should NOT Exist

- **Professional spoken-language marketplace feature** — searched for explicitly per the brief (`ProfessionalLanguage`, `professionalLanguages`, `spokenLanguage`, `languageIds` across all of `src`): **none found.** The join table (`_ProfessionalLanguages`) was already dropped in migration `20260807000000_remove_professional_languages`, with a clear doc comment explaining it was a product correction and the feature was never shipped to real users. This is a clean removal — nothing flagged here, but recorded because the brief specifically asked to verify its absence.
- **No premature Stripe/IVA business logic found.** The Stripe client (`infrastructure/payments/stripe/client.ts`) is a bare, unused SDK singleton with an explicit doc comment deferring all Connect logic to "Module 12... once payment features are built." There is no webhook route, no checkout flow, and no code path today that can actually produce a `CAPTURED` Payment — `RecordCommissionForPaymentUseCase` is fully implemented and unit-tested but structurally unreachable until a future payment-capture webhook exists to call it. `commission-policy.ts` explicitly states IVA/VAT is "NOT calculated here." This is exactly the correct posture for a pre-Stripe/pre-IVA codebase — flagged here as a **positive** finding, not a problem.
- **No committed secrets, no test/debug routes found exposed under production paths**, no `dangerouslySetInnerHTML`, no orphaned admin-only feature accidentally reachable by non-admins (aside from the missing explicit re-check in Finding #1 — the *routes themselves* are still gated by middleware today).

---

## 10. Database Findings

- **Orphaned enum values:** `ServiceRequestStatus` includes `DRAFT`, `QUOTED`, `DISPUTED`, `EXPIRED`, none of which any current use case ever writes (§3, High). Confirm intent — either implement or explicitly mark reserved-for-future in the schema doc comments (already partially done).
- **UUIDs everywhere:** every primary key uses `@default(uuid())` consistently, including `User`/`Account`/`Session` overridden from Auth.js's default `cuid()` — a deliberate, consistently-applied decision per the schema's own header comment.
- **Soft deletes:** `User.deletedAt`, `ProfessionalProfile` (implied `deletedAt` used in the discovery query at `prisma-professional-discovery-repository.ts:140`), `ServiceRequest.deletedAt` (used in the quote-acceptance transaction, `prisma-quote-acceptance-repository.ts:111`) — soft-delete is used consistently in the flows sampled, which is the right call for an audit-log-and-dispute-heavy marketplace.
- **Race-condition handling:** `AcceptQuoteUseCase`'s backing transaction (`prisma-quote-acceptance-repository.ts:105-158`) is a genuine, well-built example: pre-checks happen at the use-case layer for good error messages, but the *authoritative* check is a conditional `updateMany` inside a `$transaction`, keyed on `id + serviceRequestId + status IN (open statuses)`, so a concurrent acceptance attempt gets `count === 0` and a `ConflictError` rather than a silent double-accept. This is exactly the pattern the brief asked to look for, and it's correctly implemented here.
- **Not independently re-verified in this pass:** the brief's full checklist of index correctness, cascade/`onDelete` behavior across all ~2,683 lines of schema, and whether every migration in `prisma/migrations/` would apply cleanly to an empty database — `prisma migrate status`/`validate` could not run in this sandbox (§3, High #2). This is the single most important item to re-run before the external audit, since it's the one section this report cannot independently confirm.
- Reference/lookup tables (`Language`, `Role`, `Country`/`Province`/`City`, `PlatformSetting`) are clearly documented as deliberately added beyond the original domain-model scope, with rationale — not an inconsistency, a documented design decision.

---

## 11. Authorization Matrix

| Feature | Customer | Professional | Company | Admin |
|---|---|---|---|---|
| Create service request | ALLOW (own) | DENY | DENY | N/A |
| Edit/cancel own service request | ALLOW (own, PUBLISHED only) | DENY | DENY | N/A |
| Submit quote on a request | DENY | ALLOW (own) | ALLOW (via member) | N/A |
| Accept/reject quote | ALLOW (own request only) | DENY | DENY | N/A |
| View own appointments/jobs | ALLOW (own) | ALLOW (own) | CONDITIONAL (active member) | N/A |
| Send/delete chat message | ALLOW (own message only) | ALLOW (own message only) | ALLOW (own message only) | N/A |
| Create dispute | ALLOW (on own job) | ALLOW (on own job, solo only) | DENY *(gap, §4/§8)* | N/A |
| View disputes | ALLOW (own) | ALLOW (own) | CONDITIONAL | ALLOW (all) |
| Manage company members/roles | DENY | N/A | CONDITIONAL (role-gated: OWNER/ADMIN, never OWNER removed) | N/A |
| View any user's PII (admin users list) | DENY | DENY | DENY | ALLOW — enforced independently at `admin/layout.tsx` (re-checks role via `getCurrentUser()`), in addition to middleware (corrected, §2) |
| Suspend/reactivate user | DENY | DENY | DENY | ALLOW (`requireRole` enforced correctly in `actions.ts`) |
| Moderate reviews/portfolio | DENY | DENY | DENY | ALLOW (`requireRole` enforced correctly) |
| View commission/financial breakdown | DENY (own summary only, via dedicated safe DTO) | DENY (own earnings summary only) | DENY (own only) | ALLOW |

Incorrect/at-risk permissions identified: none remaining. The Admin column's "ALLOW" for read-only pages is backed by an independent layout-level check (`admin/layout.tsx`) in addition to middleware, matching every Admin write action's own `requireRole()` check (corrected from the original report's Critical Finding #1 — see §2).

---

## 12. Test Coverage

- **91 test files** found under `tests/`, organized as `tests/unit/core/{domain,application}` and `tests/integration/<module>/*-flows.test.ts` (one integration suite per business module: auth, booking, chat, company, discovery, dispute, financial, job, notification, portfolio, professional, profile, quotes, review, search, security, service-request, verification, admin, analytics) plus a Playwright `tests/e2e/smoke.spec.ts`.
- This breadth is good evidence of intent to cover every module named in the brief. **Could not be executed in this sandbox** (`vitest run` fails on a missing native Rollup binary for this environment's architecture — §3, High #2) — so pass/fail status of any individual test could not be confirmed here. This must be re-run in a working environment before relying on "tests exist" as "tests pass."
- Areas that appeared to have **dedicated integration coverage** (files exist, contents not individually read for every one): auth flows, admin flows, appointment lifecycle, booking flows, chat flows, company flows, discovery flows (including a dedicated `service-radius-management.test.ts`), dispute flows, financial flows, job flows, notification flows (including a separate `notification-side-effects.test.ts`), health routes, portfolio flows, professional onboarding + professional flows, profile flows, quote flows, review flows, search-directory, anti-abuse flows, service-request flows, verification flows.
- Areas **not obviously covered** by file name: middleware/route-protection integration tests for `middleware.ts` itself (unit tests for `post-login-redirect` and `profile-language-picker` exist under `tests/unit/app/`, but none target `middleware.ts`'s `ROLE_GATED_PREFIXES` gate directly); no test file name suggests broader IDOR-style adversarial tests (e.g. "customer cannot access another customer's request") — the *code* enforces this correctly everywhere sampled, but a dedicated negative-authorization test suite covering more of these boundaries is still worth adding.
- **Update:** `tests/unit/app/admin-layout-authorization.test.ts` was added during remediation of the original (since-corrected) Critical Finding #1, covering the `admin/layout.tsx` authorization boundary specifically: unauthenticated, `CUSTOMER`, `PROVIDER`, dual-role non-admin, `ADMIN`, and `SUPER_ADMIN` cases. Executed on the real development machine: **7/7 passed.**

---

## 13. Command Results

| Command | Result |
|---|---|
| `npx tsc --noEmit` | **Passed, zero output/errors.** |
| `npx eslint .` | **Passed, zero output/errors.** |
| `npx vitest run` | **Failed — environmental.** `Cannot find module '@rollup/rollup-linux-arm64-gnu'` (npm optional-dependency resolution bug on this sandbox's ARM64 Linux architecture; `npm install` of the missing package also returned `403 Forbidden` from the registry, confirming a network-restricted sandbox, not a project issue). |
| `npx next build` | **Failed — environmental.** `Failed to load SWC binary for linux/arm64` — same root cause as above. |
| `npx prisma validate` | **Failed — environmental.** `403 Forbidden` fetching `schema-engine` binary from `binaries.prisma.sh`. |
| `npx prisma migrate status` | **Failed — environmental.** Same `403 Forbidden` fetching the query engine. |
| `npx prisma generate` | Not run separately — would fail identically per the above (same engine-fetch dependency). |

**All four Prisma/build/test failures share one root cause: this sandbox cannot download platform-specific native binaries (npm registry and Prisma's binary CDN both returned `403 Forbidden`).** This is an audit-environment limitation, not evidence of a project defect. `tsc` and `eslint` succeeded because they don't depend on platform-native binaries in this setup. **Re-running `npm test`, `npm run build`, and the Prisma commands in the project's actual CI or a standard dev machine is a prerequisite before treating this section as "all clear."**

---

## 14. Technical Debt

- `package.json#prisma` seed config on the deprecated path ahead of a future Prisma 7 upgrade (§5).
- In-memory-only rate limiting, with the Redis path validated-but-unwired (§8) — fine for a single instance, a real gap the moment the app scales horizontally.
- `console.error`-only failure signaling for best-effort side effects, including audit-log writes (§4).
- Four orphaned `ServiceRequestStatus` enum values with no code path (§3/§10).
- No admin-side role-change UI yet, despite the use case/action being fully wired (§8) — deliberate per its own doc comment, listed here as debt to pay down before it's needed operationally.

---

## 15. UI/UX Issues

(Functional only, no redesign suggestions.)

- Admin user management UI intentionally omits role-change controls (`admin/users/page.tsx:14-17`, documented) — an admin who needs to grant/revoke a role today has no UI path to do it, only the underlying (unexposed) action.
- Not independently verified in this pass: loading/empty/error states across the customer- and professional-facing dashboards, mobile layout behavior, or duplicate-submission guards on client forms (e.g. double-clicking "Submit request" or "Accept quote") — the *backend* is race-safe (§10) and would reject a true double-submit at the data layer, but whether the *UI* itself disables the button/shows a spinner during the round-trip wasn't traced through the client components in this pass. Recommend a dedicated UI pass checking this for every mutating form, since a backend-safe-but-UI-silent double-click is a common source of user confusion even when no data corruption results.

---

## 16. Production Blockers

- [ ] Re-run `npm test`, `npm run build`, and `npx prisma migrate status`/`validate` in a working (non-sandboxed) environment and confirm they pass — this audit could not verify them (High #2).
- [ ] Decide and implement (or explicitly descope with a stakeholder sign-off) service-request expiry before launch, since the schema already implies it exists (High #3).
- [ ] Confirm the actual production deployment target (Dockerfile/CI) doesn't hit the same ARM/native-binary issue found in this sandbox (Medium — §4).

---

## 17. Recommended Fix Order

1. **Re-verify environment/tooling** — get `vitest`, `next build`, and Prisma commands actually running and passing in a real environment; this audit's confidence in "no other critical bugs" is bounded by not having run the full test suite in-sandbox (the one test run so far on real hardware, the admin authorization regression test, passed 7/7 — see §2).
2. **Data integrity** — resolve the orphaned `ServiceRequestStatus` states (implement expiry or formally descope it), and get a working `prisma migrate status` result confirming migrations apply cleanly.
3. **Broken/incomplete core flows** — company-initiated disputes (§4/§8).
4. **Medium bugs** — logging/observability for swallowed failures on notifications and especially audit logs (§4).
5. **UX pass** — admin role-change UI, form double-submit UX audit (§15).
6. **Technical debt** — Prisma config migration path, Redis-backed rate limiting before horizontal scaling.
7. **Stripe/IVA integration** — begin only after items 1–2 above are closed; the commission math and deferral boundary are already correctly designed and ready to receive Module 12/26.

---

## 18. Final Verdict

1. **Is the architecture stable enough to continue?** Yes. The Clean Architecture layering is consistently applied, well-documented, and the ownership/ID-trust discipline is unusually good for a pre-launch codebase.
2. **Is the platform functionally complete enough to move to UI/UX improvement?** Yes. The admin authorization concern that previously qualified this answer was a false positive (§2) — the independent check already existed and is now covered by a passing regression test.
3. **Are there critical security vulnerabilities?** None open. The one previously reported (admin read-path authorization) was a false positive, corrected in §2. No IDOR, injection, XSS sink, or credential-handling issue was found in the areas sampled.
4. **Are there critical business-logic bugs?** None found that produce incorrect state; the closest is the orphaned `ServiceRequestStatus` values / missing expiry, which is a missing feature rather than a bug in existing logic.
5. **Are there database integrity problems?** None *confirmed* — but `prisma migrate status`/`validate` could not be run in this sandbox, so "the live schema matches `schema.prisma` and all migrations apply cleanly" is unverified, not verified-clean. Re-run before trusting this fully.
6. **Are there unfinished/accidental features that should be removed?** No. The one candidate (professional spoken-language marketplace feature) was already cleanly removed with a documented migration; nothing else fits this category.
7. **What MUST be fixed before an external developer audit?** Nothing critical remains open. The High-priority items (re-running `vitest`/`next build`/Prisma commands on real infrastructure, and resolving the `ServiceRequestStatus`/expiry gap) should still be closed first, since an external auditor will otherwise hit the same environment-verification gap this audit did.
8. **What can safely wait until after the external audit?** The medium/low findings (logging strategy, Prisma config deprecation, admin role-change UI, orphaned enum cleanup) and the UI/UX pass.
9. **What should remain deferred for Stripe?** Everything currently deferred is correctly deferred — Connect onboarding, transfers, application fees, the webhook-driven commission-recording trigger. No premature Stripe logic was found; do not build ahead of Module 12.
10. **What should remain deferred for IVA?** Everything — `commission-policy.ts` explicitly and correctly produces only the pre-tax breakdown; no IVA/VAT calculation exists anywhere in the codebase today (one file references "IVA" only in a comment marking the boundary). Correct as-is.
11. **Is the platform ready for the next phase?** Yes for UI/UX work, and for the external developer audit's authorization/architecture review specifically. Still conditional on re-running the environment-blocked verification commands (§13, High #2) successfully outside this sandbox and closing the service-request-expiry gap (High #3) before production launch.
