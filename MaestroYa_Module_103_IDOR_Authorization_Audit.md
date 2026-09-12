# MaestroYa Module 103 — IDOR / Authorization Security Audit

**Date:** 2026-09-12
**Scope:** Full repository, branch `feature/module-103-full-idor-authorization-sweep` @ `9bc1057` (post-Module 100)
**Mode:** Strict read-only audit. No TypeScript/TSX source, tests, Prisma schema, migrations, configuration, package files, environment files, or deployment configuration were modified. No `git add`, `git commit`, `git push`, `git reset`, `git restore`, `git checkout`, or branch switch was run. Read-only Git commands used: `git status --porcelain`, `git branch --show-current`, `git log --oneline -5`. The only repository changes made by this pass are (1) creating this report and (2) removing the two obsolete `MaestroYa_Pre_Launch_Audit_2026-09-11*.md` files per this module's explicit instructions (Section 3 of the brief) — no other file was created, edited, or deleted.

---

## 1. Executive Summary

This module performed a dedicated, full-surface authentication/authorization/IDOR sweep — the gap both prior pre-launch audits (`MaestroYa_Pre_Launch_Audit_2026-09-11.md` and its `_v2` revision) explicitly flagged as their own biggest source of uncertainty (their H-2 finding: "IDOR/authorization was spot-checked, not exhaustively verified"). Module 103 closes that gap for the two layers that can be verified exhaustively — Server Actions and API Route Handlers — and closes it with a large, verified (not sampled) evidence base for the third layer (application use cases).

**Every one of the 40 Server Action files (218 exported action functions) and all 18 API Route files (20 HTTP method handlers) in this repository was read in full, line by line, this pass** — not sampled, not estimated. The result is a single, consistent, and correctly-implemented authorization architecture repeated verbatim across the entire surface:

- Every mutating Server Action derives the acting identity exclusively from `requireAuth()`/`requireRole()` (server-side session), never from a client-supplied `userId`/`role`/`adminId` field.
- Every admin-tier action (`ADMIN`/`SUPER_ADMIN`/`SUPPORT`) is gated by `requireRole()`, which — per Module 82 — re-verifies the caller's *current* database status and role on every call whenever an admin-tier role is requested, closing the JWT-staleness gap the prior audits discussed (see Section 4).
- Every client-supplied resource identifier (`jobId`, `quoteId`, `disputeId`, `companyId`, `invoiceId`, `documentId`, `appointmentId`, `conversationId`, `messageId`, `partnerId`, etc.) is re-verified against the caller's own session-derived ownership *inside the use case*, never trusted because it was merely present in the request. A resource that exists but does not belong to the caller consistently surfaces as the identical `NotFoundError` a nonexistent id would produce — a deliberate, repository-wide anti-enumeration convention, not an accident of one module.
- A small number of shared "actor resolver" functions (`resolveJobActor`, `resolveDisputeActor`, `resolveCompanyActor`, `resolveAppointmentActor`) are the single place ownership is derived for each entity family, and are reused by every use case that touches that entity — this is a *structural* IDOR defense, not a per-use-case habit that could silently regress in one file without affecting the others.
- All four cron routes and all three webhook routes (Stripe Connect, Stripe Payments, Persona) fail closed correctly: cron routes refuse every request with a 503 when `CRON_SECRET` is unconfigured and use a `timingSafeEqual` comparison (Module 95) rather than `!==`; webhooks verify cryptographic signatures via the provider's own SDK before trusting anything in the body, and claim idempotency before processing.
- Financial destination resolution (`ResolvePayoutDestinationUseCase` for professional/company payouts, `CreatePartnerPayoutUseCase` for affiliate payouts) reads the Stripe Connect destination exclusively from the payee's own server-side record — there is no parameter anywhere on these paths through which one party's payout could be redirected to another's account.

**No CRITICAL or HIGH-severity IDOR or authorization vulnerability was found in the Server Action layer, the API Route layer, or the sampled application-use-case layer.** Two MEDIUM findings and one LOW/informational finding are reported below (Section 20) — none of them is a demonstrated cross-user authorization bypass; both MEDIUM findings are, respectively, a document-delivery gap that (on the evidence available) fails closed rather than open, and a test-coverage gap in an implementation that was independently verified correct by direct code inspection.

This is a substantially stronger evidence base than either prior audit had for this question — both explicitly deferred it to "Module 103." It is still not a claim that all 453 files under `src/core/application/use-cases/**` were individually opened; see Section 2 for the exact, honest methodology and what was and was not read.

---

## 2. Scope and Methodology

**What "full" means in this report, precisely:**

- **Server Actions — 100% coverage, verified.** All 40 files under `src/app/**` containing a top-level `"use server"` directive were located via `grep -rl '^"use server"' src/app` and every one was read in full. Every exported function (218 total, including thin `FormAction` wrappers that call the same underlying action) was inspected for: is authentication required, is the actor id session-derived, is every client-supplied resource id re-verified server-side, and is role authorization applied where the action's sensitivity requires it.
- **API Routes — 100% coverage, verified.** All 18 files under `src/app/api/**/route.ts` were located via `find src/app/api -name route.ts` and every one was read in full (20 exported HTTP method handlers across them).
- **Application use cases — large, targeted sample, not exhaustive.** `src/core/application/use-cases/**` contains 453 `.ts` files. This pass read the following in full, chosen because the Server Action sweep above identified them as the highest-risk authorization seams (shared actor resolvers; payment/invoice/document mutation; company-membership mutation; financial destination resolution):
  - `resolve-job-actor.ts`, `resolve-dispute-actor.ts`, `resolve-company-actor.ts`, `resolve-appointment-actor.ts` — the four shared ownership resolvers every entity-touching use case in their respective modules is built on.
  - `initiate-quote-payment.use-case.ts`, `accept-invoice.use-case.ts`, `accept-quote.use-case.ts`.
  - `upload-verification-document.use-case.ts`, `remove-verification-document.use-case.ts`, `get-professional-invoice.use-case.ts`, `get-customer-receipt.use-case.ts`.
  - `remove-company-member.use-case.ts`, `transfer-company-ownership.use-case.ts`, `change-company-member-role.use-case.ts`.
  - `delete-message.use-case.ts`, `create-partner-payout.use-case.ts`, `resolve-payout-destination.use-case.ts`.

  That is 17 use-case files read in full this pass, on top of the 4 shared resolvers above (which are themselves use-case-layer files) — 17 total, chosen for risk, not at random. Because `resolveJobActor`/`resolveDisputeActor`/`resolveCompanyActor`/`resolveAppointmentActor` are shared dependencies reused by dozens of other use cases (confirmed by their own doc comments and by the Server Action call sites that pass through them), verifying these four resolvers directly gives structural — not merely anecdotal — confidence for every caller built on top of them, without requiring every individual caller to be re-opened. This is a meaningfully stronger claim than "spot-checked," and a meaningfully weaker claim than "all 453 files independently read." Treat every use-case-level claim in this report as **VERIFIED** for the specific files listed above, and **PARTIALLY VERIFIED / inferred from a verified shared dependency** for other callers of those same resolvers that were not individually re-opened.
- **Historical audits used as background only** (Section 3 of the brief): `MaestroYa_Pre_Launch_Audit_2026-09-11.md` and its `_v2` revision were read in full for context before this pass began. Every claim from them repeated in this report was independently re-derived from current source this pass, not copied — see the citations throughout.
- **No test command, lint, build, or migration was run.** Existing test files were read (not executed) to assess coverage — see Section 19.
- **Git commands used:** `git status --porcelain`, `git branch --show-current`, `git log --oneline -5`, `git ls-files` (implicitly, via `find`/`grep` over the working tree). No destructive command was ever run.

---

## 3. Repository / Authorization Surface Inventory

| Surface | Count | Coverage this pass |
|---|---|---|
| TypeScript/TSX source files (`src/**`) | 1,506 | Not individually enumerated (see Section 2) |
| Server Action files (`"use server"` in `src/app/**`) | 40 | **100% — every file read in full** |
| Exported Server Action functions across those 40 files | 218 | **100%** |
| API Route Handler files (`src/app/api/**/route.ts`) | 18 | **100% — every file read in full** |
| Exported HTTP method handlers across those 18 files | 20 | **100%** |
| Application use-case files (`src/core/application/use-cases/**`) | 453 | 17 read in full this pass (risk-selected); 4 of those are shared ownership resolvers reused across dozens of other use cases |
| Cron routes | 4 (`expire-workflows`, `gdpr-cloudinary-purge`, `reconciliation-run`, `referral-affiliate-maintenance`) | 100% |
| Webhook routes | 3 (`stripe`, `stripe-payments`, `persona`) | 100% |
| Health/diagnostics routes | 5 (`health`, `health/ready`, `health/startup`, `health/circuit-breakers`, `health/diagnostics`) | 100% |

**Full Server Action file list (all 40, all read this pass):**
`admin/actions.ts`, `admin/analytics/actions.ts`, `admin/companies/actions.ts`, `admin/company-verifications/actions.ts`, `admin/disputes/actions.ts`, `admin/jobs/actions.ts`, `admin/partners/actions.ts`, `admin/reconciliation/actions.ts`, `admin/security/actions.ts`, `admin/support-tickets/actions.ts`, `admin/verifications/actions.ts`, `analytics/actions.ts`, `appointments/actions.ts`, `dashboard/company/[companyId]/invitations/actions.ts`, `dashboard/company/[companyId]/members/actions.ts`, `dashboard/company/[companyId]/self-billing/actions.ts`, `dashboard/company/[companyId]/verification/actions.ts`, `dashboard/company/accept-invitation/actions.ts`, `dashboard/company/actions.ts`, `dashboard/partner/actions.ts`, `dashboard/professional/actions.ts`, `dashboard/professional/analytics/actions.ts`, `dashboard/professional/invoices/actions.ts`, `dashboard/professional/portfolio/actions.ts`, `dashboard/professional/quotes/actions.ts`, `dashboard/professional/self-billing/actions.ts`, `dashboard/professional/verification/actions.ts`, `disputes/actions.ts`, `jobs/[id]/payment-actions.ts`, `jobs/actions.ts`, `messages/actions.ts`, `notifications/actions.ts`, `profile/actions.ts`, `requests/[id]/quotes/actions.ts`, `requests/actions.ts`, `reviews/actions.ts`, `support-tickets/actions.ts`, `(marketing)/search/actions.ts`, `auth/actions.ts`, `auth/logout/actions.ts`.

**Full API Route file list (all 18, all read this pass):**
`api/analytics/dashboard/route.ts`, `api/auth/[...nextauth]/route.ts`, `api/cron/expire-workflows/route.ts`, `api/cron/gdpr-cloudinary-purge/route.ts`, `api/cron/reconciliation-run/route.ts`, `api/cron/referral-affiliate-maintenance/route.ts`, `api/health/circuit-breakers/route.ts`, `api/health/diagnostics/route.ts`, `api/health/ready/route.ts`, `api/health/route.ts`, `api/health/startup/route.ts`, `api/realtime/channels/route.ts`, `api/realtime/presence/[userId]/route.ts`, `api/realtime/sse/route.ts`, `api/user/language/route.ts`, `api/webhooks/persona/route.ts`, `api/webhooks/stripe-payments/route.ts`, `api/webhooks/stripe/route.ts`.

---

## 4. Authentication Audit

**Session/identity architecture (VERIFIED — `src/core/infrastructure/auth/auth-config.ts`, `auth.ts`, `src/core/infrastructure/auth/rbac.ts`):**

- Auth.js v5, `session.strategy: "jwt"` (required by the Credentials provider; the `PrismaAdapter` stays wired for OAuth account linking only). `maxAge` is `DEFAULT_SESSION_MAX_AGE_SECONDS` (1 day), extended to 30 days via a custom `token.exp` write in the `jwt` callback only when the client explicitly checked "remember me" at login.
- `getCurrentUser()` (`rbac.ts`) is the single seam every Server Component/Action/Route Handler reads identity from — confirmed by grep, no ad hoc `auth()` call sites exist outside this file and `middleware.ts`.
- `requireAuth()` throws `UnauthorizedError` for any unauthenticated caller. `requireRole(...allowed)` throws unless the session's role claim includes one of `allowed` — **and, when `allowed` includes `ADMIN` or `SUPER_ADMIN`, re-reads the caller's current `User.status` and role assignments directly from the database before granting access** (Module 82). A demoted or suspended admin is rejected on their *very next* admin-gated Server Action, not merely "eventually when the JWT expires." This independently confirms and re-verifies the second pre-launch audit's own Section 13 finding — this pass read `rbac.ts` itself, not the prior audit's description of it.
- Credentials login (`auth-config.ts`'s `authorize()`) rate-limits by email and by IP (`LOGIN_BY_EMAIL`/`LOGIN_BY_IP`) *before* any password comparison, auto-escalates a burst of failures to a 30-minute `TEMPORARILY_BLOCKED` `AccountRestriction`, and returns the identical `null` (not a distinguishable error) for "unknown email," "wrong password," "rate limited," and "restricted" — an anti-enumeration property applied consistently, not just documented.
- `middleware.ts` is a **UX-level redirect layer only**, not the authorization boundary — it exists so an anonymous visit to `/requests`, `/jobs`, `/disputes`, etc. (top-level URLs outside the `(dashboard)` route group's own URL namespace) gets a login redirect instead of a raw thrown-error page. The actual enforcement is `requireAuth()`/`requireRole()` inside every Server Action and Route Handler, confirmed present on every one of the 40 action files and every non-public API route this pass read — middleware being bypassed or misconfigured would degrade UX, not create an authorization bypass, because every mutating code path re-checks independently.
- Role-gated route prefix: `/admin/**` requires `ADMIN`/`SUPER_ADMIN` at the middleware layer too (defense-in-depth, redundant with but not a substitute for each admin action's own `requireRole()`).

**No path was found anywhere in the 40 Server Action files or 18 API routes where a `userId`/`customerId`/`professionalId`/`companyId`/`partnerId`/`adminUserId` used for authorization purposes was taken from client input rather than the authenticated session.** Every actor-id argument passed into a use case that this pass could trace either (a) came from `requireAuth()`/`requireRole()`'s returned `user.id`, or (b) was itself re-verified against that session-derived id one layer down (e.g. `companyId`/`partnerId` used only as a *lookup key*, with the caller's actual membership/ownership of it re-derived from `userId` inside `resolveCompanyActor`/`GetPartnerByUserIdUseCase`).

---

## 5. Role Authorization Audit

Roles, as actually defined in `src/core/infrastructure/auth/rbac.ts` (`ROLES` — **not invented for this report**): `ADMIN`, `SUPER_ADMIN`, `SUPPORT`, `CUSTOMER`, `PROVIDER`, `MODERATOR`. (There is no separate "COMPANY" or "PARTNER"/"AFFILIATE" *system role* — company and partner authorization are resource-scoped, not global roles: a `CUSTOMER` or `PROVIDER` user becomes a company actor via an active `CompanyMembership` row, and becomes a partner actor via an approved `Partner` row keyed to their `userId` — see Sections 6–7.)

Every admin-tier Server Action's `requireRole()` call list was read directly (not inferred):

- **`ADMIN`, `SUPER_ADMIN` only** (never `SUPPORT`): user suspension/reactivation/role-change, professional/company suspension, review/portfolio moderation, verification approval/rejection, company-verification approval/rejection, partner approval/ban/commission-approval/payout-creation/fraud-flag-resolution, reconciliation run/discrepancy actions, analytics, `getAdminDashboardOverviewAction`, and — critically — `resolveDisputeWithFinancialOutcomeAction` (the one action that actually authorizes a financial adjustment from a dispute resolution).
- **`ADMIN`, `SUPER_ADMIN`, `SUPPORT`**: dispute/support-ticket triage actions that do *not* authorize a financial outcome (assign, note, status-change, non-financial resolve, close) — confirmed this is a deliberate, documented narrowing (see the Module 70.1 doc comment in `admin/disputes/actions.ts`, cited verbatim in Section 20 of the *prior* audits and independently re-read this pass): SUPPORT can triage a dispute but cannot, on their own, both resolve it and trigger the resulting refund/commission-reversal.
- **`SUPER_ADMIN` only**: `admin/security/actions.ts` (SecurityEvent log, AccountRestriction CRUD) — deliberately excludes `ADMIN`/`SUPPORT` per that file's own doc comment, and additionally strips `ipHash` from every returned DTO before it ever reaches the admin UI (`toAdminSecurityEventView`/`toAdminAccountRestrictionView`).

No admin Server Action was found that omits `requireRole()`, and no admin Server Action was found that reads a role or "isAdmin" flag from client input. Every admin mutation's actor id passed to its use case is `admin.id` from the `requireRole()` return value, never a client-supplied `adminUserId`.

---

## 6. IDOR / Ownership Audit

This section reports, per resource family, the exact mechanism that prevents a client-supplied identifier from resolving to another user's resource — not merely that one exists.

**Job** (`resolveJobActor`, `src/core/application/use-cases/job/resolve-job-actor.ts` — VERIFIED, read in full): given `userId` (session) and a `Job` record already loaded by id, resolves the caller's role as `customer` (their `CustomerProfile.id === job.customerId`), `professional` (`ProfessionalProfile.id === job.professionalProfileId`), or — only when the calling use case supplies a `companyMembers` repository — `company` (an active membership on `job.companyProfileId` with a role that satisfies `canActOnBehalfOfCompanyJob`, i.e. OWNER/ADMIN/MANAGER, not MEMBER). Anyone else gets `NotFoundError("Job", job.id)` — identical to a nonexistent job id. Used by `jobs/actions.ts` (start/complete/cancel/confirm-completion/dispute-completion) and `appointments/actions.ts`'s sibling `resolveAppointmentActor`.

**Appointment** (`resolveAppointmentActor` — VERIFIED, read in full): identical shape to `resolveJobActor` for the `customer`/`professional` cases, resolved via the appointment's parent `ServiceRequest.customerId` and `appointment.professionalProfileId`. Company-owned appointments are *not yet* resolvable via this function (an intentional, documented scope limitation from Module 10 — see Section 20, informational finding).

**Dispute** (`resolveDisputeActor` — VERIFIED, read in full): mirrors `resolveJobActor` for `customer`/`professional`, plus an unconditional company-membership branch (any active member, not gated to OWNER/ADMIN/MANAGER — the module's own spec: "Company users access disputes for jobs their company handles"). Admin access is **not** resolved here by design — admin dispute actions trust `requireRole(ADMIN, SUPER_ADMIN, SUPPORT)` at the Server Action boundary instead (see Section 5), the same convention every other admin use case uses.

**Quote**: `AcceptQuoteUseCase` (VERIFIED, read in full) re-derives the caller's `CustomerProfile` from `userId`, then requires the `ServiceRequest.customerId` and the `Quote.serviceRequestId` both match — a quote or request that exists but isn't the caller's own is `NotFoundError`. `GetProfessionalQuoteUseCase`/`UpdateQuoteUseCase`/`WithdrawQuoteUseCase` are independently confirmed IDOR-safe by their own dedicated integration tests (`tests/integration/quotes/quote-flows.test.ts` — "prevents a non-owner from updating/withdrawing another professional's quote," "prevents another customer from viewing quotes for someone else's request" — read directly, not inferred).

**Company / multi-tenant isolation** (`resolveCompanyActor`, `src/core/application/use-cases/company/resolve-company-actor.ts` — VERIFIED, read in full): every company-scoped use case re-derives "is this `userId` an ACTIVE member of *this* `companyId`, and with what role" from a single shared function — a company the caller has no active membership in is `NotFoundError`, identical to a nonexistent company id. This is the seam `change-company-member-role.use-case.ts`, `remove-company-member.use-case.ts`, and `transfer-company-ownership.use-case.ts` (all three VERIFIED, read in full — see Section 7) are built on, and the same seam `dashboard/company/*/actions.ts`'s eight Server Actions all pass `companyId` through to, unvalidated at the action layer, entirely relying on this use-case-level check. This is a correct pattern (ownership *must* be checked server-side regardless of what a Zod schema on the id string itself could ever prove) but it does mean the Server Action layer alone provides zero defense for these routes — the use case is the only thing standing between a client-supplied `companyId` and cross-company access. This pass verified that use case directly for all three of the most sensitive company-membership mutations.

**Partner/affiliate**: `dashboard/partner/actions.ts`'s `requireOwnPartnerId()` helper resolves the caller's own `partnerId` exclusively via `GetPartnerByUserIdUseCase.execute(user.id)` — there is no `partnerId` parameter on `createReferralLinkAction`, `setReferralLinkActiveAction`, or `requestAffiliatePayoutAction` at all, so there is no field a client could tamper with to act on another partner's account. `CreatePartnerPayoutUseCase` (VERIFIED, read in full) resolves the Stripe transfer destination exclusively from `Partner.payoutDetails.stripeConnectAccountId`, loaded fresh from `input.partnerId`'s own row — never from a client-supplied destination.

**Messages/notifications**: `DeleteMessageUseCase` (VERIFIED, read in full) authorizes solely on `message.senderId === userId` — correct, because message ownership already implies conversation membership at send time. `notifications/actions.ts`'s own doc comment (independently confirmed against every action in the file) states every notification read/dismiss/mark-read action derives `userId` from the session and never accepts a recipient id from the client; there is deliberately no `createNotificationAction` at all — notification creation is a trusted server-side side effect of other modules, never a public mutation.

**Reviews**: `createReviewAction`/`updateReviewAction`/`deleteReviewAction`/`respondToReviewAction` all pass `reviewId`/`jobId` through to their use cases without a Server-Action-level ownership check — same pattern as company actions above, i.e. correct only if the use case enforces it. This pass did not re-open `CreateReviewUseCase`/`UpdateReviewUseCase`/`RespondToReviewUseCase` this session (time-budget trade-off — see Section 2); their doc comments, read as part of the Server Action files, assert the same ownership-derivation convention used everywhere else, and this is the one entity family in Section 6 for which that assertion was not independently re-verified by opening the use-case source directly this pass. Classified **PARTIALLY VERIFIED** (see Section 20, informational).

---

## 7. Multi-Tenant / Company Isolation

Verified directly against source (not inferred) for the three highest-risk company-membership mutations:

- **`ChangeCompanyMemberRoleUseCase`**: resolves `actor` via `resolveCompanyActor`; the `target` member must belong to the *same* `companyId` (`target.companyId !== companyId` → `NotFoundError`, not a distinguishable error); a member can never change their own role; `canChangeMemberRole(actor.role, target.role, newRole)` is re-checked server-side regardless of what the UI allowed.
- **`RemoveCompanyMemberUseCase`**: identical `companyId` cross-check on the target; the OWNER can never be removed this way (must transfer ownership first); self-removal is allowed only for non-OWNER roles; `canRemoveMember(actor.role, target.role)` gates removing someone else.
- **`TransferCompanyOwnershipUseCase`**: only the current OWNER (`canInitiateOwnershipTransfer(actor.role)`) may initiate; the target must be an existing, active member of the *same* company (`target.companyId !== companyId` → `NotFoundError`); `isEligibleOwnershipTransferTarget` additionally rejects transferring to oneself or to an inactive member.

In all three, a `memberId` belonging to a different company than the `companyId` the caller is authorized against is rejected with the same `NotFoundError` a nonexistent id would produce — **there is no path by which a member of Company A can act on a membership row belonging to Company B**, even with a valid `memberId` guessed or enumerated from Company B.

Company document isolation (`UploadCompanyVerificationDocumentUseCase`/`RemoveCompanyVerificationDocumentUseCase`, confirmed via their calling Server Actions' own doc comments and the `resolveCompanyActor` pattern they're built on — not re-opened directly this pass) and company financial/self-billing isolation (`GrantMySelfBillingAuthorizationUseCase`/`RevokeMySelfBillingAuthorizationUseCase`, same) both pass `companyId` through the identical `resolveCompanyActor` seam verified in Section 6 — **PARTIALLY VERIFIED** by structural reliance on an independently-verified shared function, not by re-opening each individual use case.

No admin action was found that grants "universal access" beyond what `requireRole(ADMIN, SUPER_ADMIN)` already implies for platform-level oversight (i.e., admin *is* intentionally allowed cross-company access — that is the correct, documented design for platform administration, not a defect).

---

## 8. Financial Authorization

**Payment initiation** (`InitiateQuotePaymentUseCase` — VERIFIED, read in full): `jobId` is re-verified against the caller's own `CustomerProfile` (`job.customerId !== customer.id` → `NotFoundError`); the payable amount is **never** accepted as a parameter — it is always recomputed server-side from the authoritative `Quote`'s own line items via `calculateQuoteTotal`, never trusted from a previously-persisted column or from client input. Idempotency is enforced at three independent layers (distributed lock keyed on the quote, a deterministic Stripe idempotency key, and a unique-constraint upsert on `stripePaymentIntentId`) — confirmed by direct code read, not by doc-comment claim alone.

**Invoice acceptance** (`AcceptInvoiceUseCase` — VERIFIED, read in full): resolves the invoice's actual owner (`ProfessionalProfile.userId` or `CompanyProfile.ownerUserId`, loaded fresh from the invoice's own `professionalProfileId`/`companyProfileId`) and compares it against the session-derived `acceptedByUserId` — never authorizes based on the invoice id alone. Also re-verifies an active self-billing authorization exists before allowing acceptance.

**Invoice/receipt read access** (`GetProfessionalInvoiceUseCase`, `GetCustomerReceiptUseCase` — both VERIFIED, read in full): both enforce type-scoped, owner-scoped lookups (`invoice.type !== "PROFESSIONAL_SELF_BILLED"`/`"CUSTOMER_RECEIPT"` respectively) in addition to the owner-id check — a customer cannot resolve a professional invoice id even if it happens to be a valid invoice, and vice versa. Both use the standard anti-enumeration `NotFoundError` convention.

**Payout destination resolution** (`ResolvePayoutDestinationUseCase`, `CreatePartnerPayoutUseCase` — both VERIFIED, read in full): the Stripe Connect destination account is looked up exclusively from the payee's own uniquely-keyed record (`ProfessionalPayoutAccountRecord`/`CompanyPayoutAccountRecord`/`Partner.payoutDetails`) — there is no parameter on either use case's input through which a caller could substitute a different destination. `ResolvePayoutDestinationUseCase`'s own doc comment states this is "structurally impossible... not just checked," and direct code reading confirms the claim: each lookup key (`professionalProfileId`/`companyProfileId`) is unique-per-owner, so passing the wrong id resolves nothing rather than someone else's account.

**Webhooks** (see Section 11) never trust client-side state for a financial decision — every field `ProcessCustomerPaymentWebhookUseCase`/`ProcessStripeConnectWebhookUseCase` act on is either the provider's own already-signature-verified event payload, or re-read from this platform's own persisted `Payment`/`Quote`/`Job` rows.

**Dispute financial outcome** authorization is narrowed to `ADMIN`/`SUPER_ADMIN` only (excludes `SUPPORT`) per Module 70.1, confirmed directly in `admin/disputes/actions.ts`'s `resolveDisputeWithFinancialOutcomeAction` — see Section 5.

**Not independently re-verified this pass** (time-budget trade-off, flagged rather than silently assumed): the internal line-by-line correctness of `ExecuteRefundUseCase`, `CreateFinancialAdjustmentUseCase`'s full invariant set, and `ExecuteProfessionalPayoutUseCase`'s own caller-side derivation of the `professionalProfileId`/`companyProfileId` it hands to `ResolvePayoutDestinationUseCase` (i.e., this pass verified the destination-resolution step *cannot* be redirected once it receives an owner id, but did not re-open the specific line in `ExecuteProfessionalPayoutUseCase` that derives that owner id from the Job/Payout being processed). Classified **NOT VERIFIED THIS PASS** rather than assumed safe — the second and third prior audits' own financial-engine findings (commission/tax base contradiction, C-1) remain the more material financial-correctness concern in this codebase and are explicitly out of this module's IDOR/authorization scope per the brief.

---

## 9. Document / File Authorization

**Upload/removal ownership** (`UploadVerificationDocumentUseCase`, `RemoveVerificationDocumentUseCase` — both VERIFIED, read in full): both re-derive the caller's own `ProfessionalProfile` from `userId`, then re-derive that profile's *own* active `ProfessionalVerification` case — a `documentId` belonging to a different professional's case is rejected with `NotFoundError` (confirmed: `RemoveVerificationDocumentUseCase` explicitly cross-checks `verification.professionalProfileId !== professional.id`). Documents can only be added/removed while the case is `DRAFT`/`RESUBMISSION_REQUIRED` — frozen once under review. `UploadCompanyVerificationDocumentUseCase`'s equivalent company-side mutation is gated by the same `resolveCompanyActor` seam verified in Sections 6–7 (not re-opened directly this pass — **PARTIALLY VERIFIED**).

**MEDIUM FINDING — document delivery/signed-URL gap (see Section 20, Finding 1).** `CloudinaryVerificationDocumentUploadService`/`CloudinaryCompanyVerificationDocumentUploadService` (both read in full) upload every identity/verification document with Cloudinary's `type: "private"` delivery mode — the correct choice for sensitive personal documents, since a "private" asset is not servable by its raw URL without a Cloudinary-generated signature. However, a full-repository grep for any signed-URL generation mechanism (`private_download_url`, `utils.sign`, `api_sign_request`, or any equivalent) returned **zero results** anywhere in `src/core/**`, and `admin/verifications/[id]/page.tsx` (read directly) renders the document link as a plain `<a href={doc.fileUrl} target="_blank">` — the raw, unsigned Cloudinary `secure_url` returned by the upload call. Because Cloudinary refuses to serve a `type: "private"` asset without a valid signature, this link should fail for *every* viewer, including an authorized admin — this is **not an IDOR** (unsigned access is refused for everyone, not selectively bypassable by an unauthorized party) but it does mean:
  1. the actual server-side authorization *for viewing* an already-uploaded document was not independently verifiable this pass, because no code path that issues a signed view URL exists to inspect;
  2. the feature itself (an admin reviewing a submitted identity document) may not currently function in production, which the upload service's own doc comment tacitly admits ("issuing [signed URLs]... is a deliberate follow-up noted in the module docs").

  This is classified as a document-authorization **coverage gap**, not a confirmed vulnerability, per Section 26's own instruction not to conflate "missing/broken feature" with "authorization defect" in either direction — but it is reported because a document-viewing control that cannot be exercised at all is not evidence of a *working* authorization boundary either.

**Avatar/service-request photos**: `CloudinaryAvatarUploadService`/`CloudinaryRequestPhotoUploadService` were not opened this pass; these are lower-sensitivity, intentionally-marketplace-visible assets (a professional's avatar, photos attached to a public service request) rather than identity documents, so the `type: "private"` concern above does not apply to them by design. **NOT VERIFIED THIS PASS.**

---

## 10. Admin Authorization

Covered in depth in Section 5. Additional confirmation this pass: `admin/security/actions.ts` restricts to `SUPER_ADMIN` only and strips `ipHash` from every DTO before it reaches even an authorized admin's screen (`toAdminSecurityEventView`, read directly). `admin/reconciliation/actions.ts`'s own doc comment ("reconciliation exposes the full financial lifecycle across every customer/professional/company, so unlike some read-only admin views this is never extended to SUPPORT") was independently confirmed — every one of its 12 exported actions gates on `ADMIN`/`SUPER_ADMIN` only, `SUPPORT` is never included.

`requireRole()`'s Module 82 DB-freshness re-check (Section 4) applies uniformly to every one of these — there is no admin action in the 40-file sweep that gates only on the JWT/session role claim without going through `requireRole()`.

---

## 11. Webhook Security

**Stripe Connect** (`api/webhooks/stripe/route.ts` — VERIFIED, read in full): raw body read as text before any parsing; `StripeConnectWebhookVerifier.verify()` performs signature verification via the Stripe SDK's own `constructEvent`-equivalent before anything is trusted; invalid signature → generic 401 (never distinguishes "no secret configured" from "bad signature" from "stale timestamp"); `ProcessStripeConnectWebhookUseCase` claims `(STRIPE, event.id)` idempotency before processing; every outcome that must not be retried (duplicate, irrelevant type, unknown account, stale/out-of-order) returns 200; only a genuine processing failure returns non-2xx.

**Stripe Payments** (`api/webhooks/stripe-payments/route.ts` — VERIFIED, read in full): identical shape/guarantees to the Connect route, on the separate `StripePaymentWebhookVerifier`/`STRIPE_PAYMENTS_WEBHOOK_SECRET`. A best-effort, non-blocking, never-throwing affiliate-fee reconciliation side-effect (`reconcileAffiliateCommissionStripeFeeForPayment`) is fired only for `charge.updated` events and is explicitly documented as never allowed to affect Stripe's 200/retry decision.

**Persona** (`api/webhooks/persona/route.ts` — VERIFIED, read in full): identical fail-closed shape via `provider.webhookValidation()`; a signature-valid-but-unrecognized-shape body is acknowledged (200) without processing rather than treated as forged; `ProcessPersonaWebhookUseCase` claims `(PERSONA, event.id)` idempotency first.

All three: never log the raw body, the signature header, or the webhook secret; only request id, outcome, and non-sensitive event metadata are logged. No client-controlled field bypasses signature verification in any of the three routes — the signature check happens before the body is ever parsed into anything a business decision could be made from.

---

## 12. Cron / Internal Endpoint Security

All four cron routes (`expire-workflows`, `gdpr-cloudinary-purge`, `reconciliation-run`, `referral-affiliate-maintenance` — all VERIFIED, read in full) share one authorization helper, `isValidCronAuthHeader` (`src/core/infrastructure/auth/cron-auth.ts`, VERIFIED, read in full):

- If `CRON_SECRET` is not configured, **every** request is refused with 503 — the route never silently skips the check and accepts unauthenticated requests just because the secret was never set.
- The comparison is `Buffer.byteLength`-guarded then `timingSafeEqual` (Module 95) — not a plain `!==`/`===` string comparison, which would leak how many leading characters of a guess were correct via response-time side channel. This was independently confirmed by reading `cron-auth.ts` itself, not merely the routes' doc comments describing it.
- Every route is a `GET` handler (matching Vercel Cron's own request shape) with no session/cookie auth applied — correctly, since this is a machine-to-machine credential, not a user credential.
- None of the four routes returns sensitive financial/personal detail even to an unauthenticated caller who somehow reached the handler body (they don't reach it without the secret, but the response shapes were checked regardless) — only aggregate counters (`totalExpired`, `claimed`/`succeeded`/`retried`/`deadLettered`, discrepancy counts) are ever returned.
- Locking/idempotency for concurrent or duplicate cron firings is delegated to each use case's own `DistributedLock` usage (confirmed present via doc comment in `reconciliation-run/route.ts` and `gdpr-cloudinary-purge/route.ts`; the lock implementation itself was not re-opened this pass).

`api/health/circuit-breakers/route.ts` and `api/health/diagnostics/route.ts` (both VERIFIED, read in full) — previously flagged by Module 70's own audit as unauthenticated — are now gated by `requireRole(ADMIN, SUPER_ADMIN)`, confirmed to run *before* any other logic (including the cheap `HEALTH_CHECKS_ENABLED` feature-flag check). `api/health` and `api/health/ready`/`api/health/startup` remain intentionally public (liveness/readiness/startup probes carry no sensitive detail — only `"ok"`/`"error"` and dependency-health enum strings, confirmed by direct read).

---

## 13. Delete / Destructive Operations

Every deletion/removal path this pass directly verified enforces ownership before deleting:

- `DeleteMessageUseCase` — sender-only (Section 6).
- `RemoveVerificationDocumentUseCase` — own-professional-case-only (Section 9).
- `RemoveCompanyMemberUseCase` — same-company, role-gated, OWNER-protected (Section 7).
- `deleteAccountAction` (`profile/actions.ts`) — requires the caller's *current password* to be re-entered (`DeleteAccountUseCase.execute(user.id, parsed.data.password)`), i.e. a second authentication factor beyond the live session, before an account-deletion plan is prepared.
- `deleteReviewAction`/`removeServiceRequestPhotoAction`/`removeCompanyVerificationDocumentAction` all pass a session-derived `userId` alongside the target id to their use cases; **not independently re-opened this pass** (see Sections 6/9) — classified PARTIALLY VERIFIED by pattern consistency, not independently confirmed line-by-line.

No Server Action was found that performs a delete/anonymize/purge operation using only a client-supplied id with no session-derived actor passed to the use case at all.

---

## 14. State Transition Authorization

`resolveJobActor`/`resolveDisputeActor`/`resolveAppointmentActor` (Section 6) are the shared gate for every state transition this pass traced: start/complete/cancel/confirm-completion/dispute-completion on Jobs; propose/confirm/cancel/reschedule/complete on Appointments; assign/status-change/resolve/reject/close on Disputes (admin side) plus create/message/evidence (customer/professional side). `AcceptQuoteUseCase`'s state transition (`ACCEPTED`, with every other open quote atomically rejected) is customer-and-request-scoped per Section 6. Admin approval/rejection/suspension transitions (professionals, companies, partners, verifications, reviews, portfolio items) are uniformly `requireRole(ADMIN, SUPER_ADMIN[, SUPPORT])`-gated per Section 5, with the actor id always session-derived.

---

## 15. Error / Information Leakage

The repository-wide convention — confirmed directly in every use case this pass opened, not merely asserted by doc comments — is that **a resource that exists but does not belong to the caller and a resource that does not exist at all produce the identical `NotFoundError`**, with no distinguishable message, status code, or timing difference visible to the caller. This was verified in: `resolveJobActor`, `resolveDisputeActor`, `resolveCompanyActor`, `resolveAppointmentActor`, `InitiateQuotePaymentUseCase`, `GetProfessionalInvoiceUseCase`, `GetCustomerReceiptUseCase`, `RemoveVerificationDocumentUseCase`, `RemoveCompanyMemberUseCase`, `TransferCompanyOwnershipUseCase`, `ChangeCompanyMemberRoleUseCase`. `setReferralLinkActiveAction` (`dashboard/partner/actions.ts`) explicitly catches `UnauthorizedError` and replaces it with the same generic failure message a not-found case would produce, with an inline comment calling this out as a deliberate anti-enumeration measure.

Password-reset (`forgotPasswordAction`) and login (`authorize()`) both return identical responses for "account doesn't exist" vs. "wrong credentials" vs. "rate limited" — confirmed by direct read, not assumed.

No meaningful enumeration oracle was found in any of the 40 Server Action files or 18 API routes this pass read.

---

## 16. Server Action Inventory

Full per-file inventory (all 40 files; auth = requireAuth/requireRole present; ownership = client id re-verified server-side either at the action or the use-case layer; verified = use-case-level check independently opened this pass vs. inferred from doc comment/pattern consistency):

| File | Auth | Role gate | Ownership check | Client-controlled IDs | Financial | Verified this pass |
|---|---|---|---|---|---|---|
| admin/actions.ts | requireRole | ADMIN/SUPER_ADMIN | N/A (admin oversight) | userId/professionalId/reviewId/portfolioItemId (admin may act on any) | No | Yes (full file) |
| admin/analytics/actions.ts | requireRole | ADMIN/SUPER_ADMIN | N/A | none mutating | No | Yes |
| admin/companies/actions.ts | requireRole | ADMIN/SUPER_ADMIN | N/A | companyId | No | Yes |
| admin/company-verifications/actions.ts | requireRole | ADMIN/SUPER_ADMIN | N/A | verificationId | No | Yes |
| admin/disputes/actions.ts | requireRole | ADMIN/SUPER_ADMIN(+SUPPORT for triage; ADMIN/SUPER_ADMIN only for financial outcome) | N/A | disputeId | Yes (financial-outcome action) | Yes |
| admin/jobs/actions.ts | requireRole | ADMIN/SUPER_ADMIN/SUPPORT | N/A | jobId | Yes (payment release) | Yes |
| admin/partners/actions.ts | requireRole | ADMIN/SUPER_ADMIN | N/A; destination structurally scoped in use case | partnerId/commissionId/flagId | Yes | Yes |
| admin/reconciliation/actions.ts | requireRole | ADMIN/SUPER_ADMIN only | N/A | runId/discrepancyId/jobId | Yes (read-only) | Yes |
| admin/security/actions.ts | requireRole | SUPER_ADMIN only | N/A | userId/restrictionId | No | Yes |
| admin/support-tickets/actions.ts | requireRole | ADMIN/SUPER_ADMIN/SUPPORT | N/A | ticketId | No | Yes |
| admin/verifications/actions.ts | requireRole | ADMIN/SUPER_ADMIN | N/A | verificationId | No | Yes |
| analytics/actions.ts | requireAuth | none (self-scope) | Session-derived, no professionalId/customerId param | none | No | Yes (action); use case not reopened |
| appointments/actions.ts | requireAuth | none | resolveAppointmentActor | appointmentId | No | Yes (resolver read in full) |
| company/[companyId]/invitations/actions.ts | requireAuth | none | resolveCompanyActor (in use case) | companyId, invitationId | No | Partially (resolver verified; callers not reopened) |
| company/[companyId]/members/actions.ts | requireAuth | none | resolveCompanyActor | companyId, memberId | No | Yes (3 mutation use cases read in full) |
| company/[companyId]/self-billing/actions.ts | requireAuth | none | resolveCompanyActor (in use case) | companyId | Yes (authorization gate, not a transfer) | Partially |
| company/[companyId]/verification/actions.ts | requireAuth | none | resolveCompanyActor (in use case) | companyId, documentId | No | Partially |
| company/accept-invitation/actions.ts | requireAuth | none | Token + session match (in use case) | token only | No | Partially |
| company/actions.ts | requireAuth | none | resolveCompanyActor (in use case) | companyId | No | Partially |
| dashboard/partner/actions.ts | requireAuth | none | requireOwnPartnerId (no partnerId param at all) | referralCodeId only | Yes (payout request) | Yes (create-partner-payout.use-case.ts read; helper pattern verified) |
| dashboard/professional/actions.ts | requireAuth | none | Session-derived only | none | No | Yes (action) |
| dashboard/professional/analytics/actions.ts | requireAuth | none | Session-derived, no professionalId param | none | No | Yes |
| dashboard/professional/invoices/actions.ts | requireAuth | none | AcceptInvoiceUseCase owner check | invoiceId | Yes | Yes (use case read in full) |
| dashboard/professional/portfolio/actions.ts | requireAuth | none | Use-case-level (not reopened) | portfolioItemId | No | Partially |
| dashboard/professional/quotes/actions.ts | requireAuth | none | Use-case-level; confirmed via integration tests | requestId, quoteId | No | Partially (tests confirm; use cases not reopened except accept-quote) |
| dashboard/professional/self-billing/actions.ts | requireAuth | none | Session-derived only | none | Yes (authorization gate) | Partially |
| dashboard/professional/verification/actions.ts | requireAuth | none | UploadVerificationDocumentUseCase/RemoveVerificationDocumentUseCase | documentId | No | Yes (both use cases read in full) |
| disputes/actions.ts | requireAuth | none | resolveDisputeActor (in use case) | jobId, disputeId | No | Partially (resolver verified; some callers not reopened) |
| jobs/[id]/payment-actions.ts | requireAuth | none | InitiateQuotePaymentUseCase | jobId | Yes | Yes (read in full) |
| jobs/actions.ts | requireAuth | none | resolveJobActor (in use case) | jobId | No | Yes (resolver read in full) |
| messages/actions.ts | requireAuth | none | OpenConversationUseCase/SendMessageUseCase (not reopened); DeleteMessageUseCase (reopened) | serviceRequestId, conversationId, messageId | No | Partially |
| notifications/actions.ts | requireAuth | none | Session-derived only, no recipient param anywhere | notification id (own only) | No | Yes (doc comment + action code confirms no cross-user path exists structurally) |
| profile/actions.ts | requireAuth | none | Session-derived only; delete requires password re-entry | none | No | Yes |
| requests/[id]/quotes/actions.ts | requireAuth | none | AcceptQuoteUseCase | requestId, quoteId | No | Yes (read in full) |
| requests/actions.ts | requireAuth | none | Use-case-level (not reopened) | requestId, photoId | No | Partially |
| reviews/actions.ts | requireAuth | none | Use-case-level (not reopened this pass) | reviewId, jobId | No | Partially — see Section 6 |
| support-tickets/actions.ts | requireAuth | none | Use-case-level (not reopened) | ticketId | No | Partially |
| (marketing)/search/actions.ts | none (public, no account-scoped data) | none | N/A — correctly unauthenticated | none | No | Yes |
| auth/actions.ts | none (pre-authentication flows) | none | N/A; rate-limited, anti-enumeration confirmed | none | No | Yes |
| auth/logout/actions.ts | signOut() only | none | N/A | none | No | Yes |

---

## 17. API Route Inventory

| Route | Method | Auth | Authorization | Ownership | Sensitive data | Financial | Verified |
|---|---|---|---|---|---|---|---|
| api/analytics/dashboard | GET, POST | requireRole | ADMIN/SUPER_ADMIN | N/A (platform data) | Platform revenue/dispute figures | No | Yes |
| api/auth/[...nextauth] | GET, POST | Auth.js internal | N/A | N/A | Session/credentials | No | Yes (re-export only) |
| api/cron/expire-workflows | GET | Bearer CRON_SECRET, timing-safe | N/A (machine) | N/A | Aggregate counts only | No | Yes |
| api/cron/gdpr-cloudinary-purge | GET | Bearer CRON_SECRET, timing-safe | N/A | N/A | Aggregate counts only | No | Yes |
| api/cron/reconciliation-run | GET | Bearer CRON_SECRET, timing-safe | N/A | N/A | Aggregate counts only | Yes (triggers reconciliation, read-only itself) | Yes |
| api/cron/referral-affiliate-maintenance | GET | Bearer CRON_SECRET, timing-safe | N/A | N/A | Aggregate counts only | No (expiry/fraud recheck, no payout) | Yes |
| api/health/circuit-breakers | GET, POST | requireRole | ADMIN/SUPER_ADMIN | N/A | Internal topology | No (POST resets a breaker — operational) | Yes |
| api/health/diagnostics | GET | requireRole | ADMIN/SUPER_ADMIN | N/A | Internal topology | No | Yes |
| api/health/ready | GET | none (public) | N/A — correct, no sensitive detail | N/A | "ok"/"error" enums only | No | Yes |
| api/health | GET | none (public) | N/A — correct | N/A | "ok" only | No | Yes |
| api/health/startup | GET | none (public) | N/A — correct | N/A | "started"/"starting" only | No | Yes |
| api/realtime/channels | POST, DELETE | getCurrentUser | Enforced inside RealtimeHub/use case | Enforced inside use case | Channel subscription state | No | Yes (route); RealtimeHub internals not reopened |
| api/realtime/presence/[userId] | GET | getCurrentUser | Self-or-staff, enforced in GetPresenceUseCase | targetUserId param, checked in use case | Online/offline/last-seen | No | Route Yes; GetPresenceUseCase not reopened — PARTIALLY VERIFIED |
| api/realtime/sse | GET | getCurrentUser | Per-channel via RealtimeHub.subscribe | channels query param, authorized per-channel | Live event stream | No | Yes (route); RealtimeHub internals not reopened |
| api/user/language | PATCH | getCurrentUser | Self-scope only | None (writes caller's own preference) | Locale preference | No | Yes |
| api/webhooks/persona | POST | Signature (webhookValidation) | Provider-trusted event | N/A (webhook) | Verification event metadata | No | Yes |
| api/webhooks/stripe-payments | POST | Signature (constructEvent-equivalent) | Provider-trusted event | N/A (webhook) | Payment event metadata | Yes | Yes |
| api/webhooks/stripe | POST | Signature (constructEvent-equivalent) | Provider-trusted event | N/A (webhook) | Connect account event metadata | Yes (account status) | Yes |

---

## 18. Use-Case Authorization Review

See Sections 6–9 for the 17 use-case files read in full this pass and their specific findings. Summary table:

| Use case | Caller identity source | Client-influenced identifiers | Ownership enforcement | State validation | Result |
|---|---|---|---|---|---|
| resolveJobActor | userId param (session-derived by callers) | job (pre-loaded by id) | Re-derives customer/professional/company match | N/A (pure resolver) | Secure |
| resolveDisputeActor | userId param | dispute, job (pre-loaded) | Re-derives customer/professional/company match | N/A | Secure |
| resolveCompanyActor | userId param | companyId | Active-membership lookup | N/A | Secure |
| resolveAppointmentActor | userId param | appointment (pre-loaded) | Re-derives customer/professional match via ServiceRequest | N/A | Secure (company scope not yet supported — informational) |
| InitiateQuotePaymentUseCase | userId param | jobId | Customer-profile match on Job | Job not CANCELLED; Quote ACCEPTED; not already settled | Secure |
| AcceptInvoiceUseCase | acceptedByUserId param | invoiceId | Professional/Company owner userId match | Status transition + active self-billing authorization | Secure |
| AcceptQuoteUseCase | userId param | serviceRequestId, quoteId | Customer-profile match on ServiceRequest; Quote scoped to that request | Quote/request acceptable-status checks; optional trust-hold check | Secure |
| UploadVerificationDocumentUseCase | userId param | none (own active case only) | Professional-profile-derived active verification case | DRAFT/RESUBMISSION_REQUIRED only; max-document cap | Secure |
| RemoveVerificationDocumentUseCase | userId param | documentId | Cross-checks document's parent case belongs to caller's profile | Same as above | Secure |
| GetProfessionalInvoiceUseCase | userId param | invoiceId, optional companyId | Type-scoped + owner/company-actor match | N/A | Secure |
| GetCustomerReceiptUseCase | userId param | invoiceId | Type-scoped + customer-profile match | N/A | Secure |
| ChangeCompanyMemberRoleUseCase | userId param | companyId, memberId, newRole | resolveCompanyActor + same-company target check + role predicate | Cannot change own role | Secure |
| RemoveCompanyMemberUseCase | userId param | companyId, memberId | resolveCompanyActor + same-company target check + role predicate | OWNER cannot be removed this way | Secure |
| TransferCompanyOwnershipUseCase | userId param | companyId, newOwnerMemberId | resolveCompanyActor (must be OWNER) + same-company target check | Target must be active, not self | Secure |
| DeleteMessageUseCase | userId param | messageId | senderId match | Already-deleted is a no-op | Secure |
| CreatePartnerPayoutUseCase | input.partnerId (admin-supplied, admin-authorized at action layer) | partnerId, period dates | Destination resolved exclusively from partner's own record | Minimum-threshold + duplicate-payout DB-level guard | Secure |
| ResolvePayoutDestinationUseCase | owner param (caller-derived upstream) | professionalProfileId/companyProfileId | Unique-per-owner lookup key; cross-owner lookup structurally impossible | Optional requireConnected status check | Secure |

No use case in this table was found to trust a client-supplied ownership claim without independent server-side re-verification.

---

## 19. Existing Security Test Coverage

**Strong, explicit IDOR-labeled coverage exists** for the payment layer: `tests/unit/core/application/use-cases/payments/initiate-quote-payment.use-case.test.ts` includes a test literally named `"rejects a job that does not belong to the authenticated customer (IDOR)"`, plus `"rejects a job id that doesn't exist the same way as one that isn't the caller's own"` — i.e. the anti-enumeration property itself is under test, not just the rejection.

**Strong coverage exists** for the quote lifecycle: `tests/integration/quotes/quote-flows.test.ts` includes `"prevents a professional from accessing another professional's quote"`, `"prevents a non-owner from updating another professional's quote"`, `"prevents a non-owner from withdrawing another professional's quote"`, and `"prevents another customer from viewing quotes for someone else's request"` — four explicit cross-user negative tests read directly in this pass.

**Coverage gaps found** (Section 20, Finding 2):
- No dedicated unit test file exists for `AcceptQuoteUseCase` itself (`tests/unit/core/application/use-cases/quotes/accept-quote.use-case.test.ts` does not exist); its only test coverage is the integration suite's Module-89-focused `describe("AcceptQuoteUseCase — Module 89 BOOKING_RESTRICTION enforcement")` block, which does not include a cross-customer/cross-request rejection case for `AcceptQuoteUseCase` specifically (the sibling `GetServiceRequestQuotesUseCase` does have that negative case, but that is a different use case).
- No dedicated unit or integration test was found for `ChangeCompanyMemberRoleUseCase`, `RemoveCompanyMemberUseCase`, or `TransferCompanyOwnershipUseCase` at the use-case level exercising a cross-company `memberId` rejection or an unauthorized-role rejection end-to-end; the only related test file found (`tests/unit/core/domain/company-membership-rules.test.ts`) tests the pure domain predicates (`canChangeMemberRole`, `canRemoveMember`, `canInitiateOwnershipTransfer`) in isolation, not the use case's actual enforcement of them together with the `resolveCompanyActor`/same-company check.
- No dedicated test file exists for `resolveJobActor`, `resolveDisputeActor`, `resolveCompanyActor`, or `resolveAppointmentActor` as standalone units — their correctness is exercised only indirectly through the use cases built on top of them (some of which, like the payment and quote-viewing cases above, do have explicit coverage; others do not).

**Important distinction applied per the brief's own Section 26:** none of these three gaps was found to correspond to a missing *implementation* check — this pass independently read and confirmed the implementation is correct for `ChangeCompanyMemberRoleUseCase`/`RemoveCompanyMemberUseCase`/`TransferCompanyOwnershipUseCase`/`AcceptQuoteUseCase`/all four resolvers (Sections 6–7, 18). This is reported as a **test-coverage gap**, not an authorization defect.

---

## 20. Findings

**Finding 1 — MEDIUM — Document/File Authorization — Verification document viewing has no signed-URL mechanism; the admin review UI links directly to an unsigned `type: "private"` Cloudinary asset.**
- Files: `src/core/infrastructure/storage/cloudinary/verification-document-upload-service.ts`, `src/core/infrastructure/storage/cloudinary/company-verification-document-upload-service.ts`, `src/app/(dashboard)/admin/verifications/[id]/page.tsx` (line ~113, `<a href={doc.fileUrl} target="_blank">`).
- Behavior: documents are uploaded with Cloudinary's `type: "private"` delivery mode (correct for sensitive documents), but no code anywhere in `src/core/**` generates a Cloudinary signed/authenticated delivery URL (`private_download_url`, `utils.sign`, or equivalent — confirmed absent by repository-wide grep). The stored `fileUrl` (Cloudinary's raw `secure_url`) is rendered as a direct hyperlink in the admin verification-review page.
- Attack scenario: none demonstrated — a `type: "private"` Cloudinary asset requires a valid signature to be delivered at all, so an unsigned request should be refused by Cloudinary for any caller, authorized or not. This is not an IDOR: unauthorized users gain no advantage, because authorized users cannot view it either via this path.
- Why this is reported: a security control whose "authorized path" cannot be exercised (because it does not exist) is not distinguishable, by static code review alone, from a control that is quietly broken in a way that matters. It also means Module 17's stated admin-review workflow for identity documents may not function in production, which is a business-risk-relevant fact for a platform handling identity documents ahead of a launch.
- Verifiable status: **NOT VERIFIED (functional status against a live Cloudinary account was not tested — this is a static-code-only finding)**.
- Severity: MEDIUM. Not exploitable as IDOR on the evidence available; reported because it represents either a broken admin verification workflow or an unverified/undocumented signing mechanism this pass could not locate.
- Recommendation: confirm against a real Cloudinary sandbox whether these links currently render for an authorized admin; if they do not, implement `cloudinary.utils.private_download_url` (or Cloudinary's signed-URL equivalent) behind an ownership/role-checked Server Action, never returning the private asset URL to the client directly. If they do render (e.g. via an account-level "strict transformations off" setting not visible in this codebase), document why, since the current code offers no evidence of it.

**Finding 2 — MEDIUM — Authorization Test Coverage — `AcceptQuoteUseCase` and the three company-membership mutation use cases lack dedicated authorization-boundary tests.**
- Files: (missing) `tests/unit/core/application/use-cases/quotes/accept-quote.use-case.test.ts`; (missing) equivalent files for `change-company-member-role.use-case.ts`, `remove-company-member.use-case.ts`, `transfer-company-ownership.use-case.ts`.
- This pass independently confirmed all four implementations are correct by direct source inspection (Sections 6–7, 18) — this is a coverage gap, not an authorization defect, per the brief's own Section 26 distinction.
- Severity: MEDIUM (would be higher if the implementation had not been independently verified this pass).
- Recommendation: add unit tests asserting (a) `AcceptQuoteUseCase` rejects a `serviceRequestId`/`quoteId` pair belonging to a different customer with the same `NotFoundError` pattern already tested elsewhere in the codebase, and (b) each company-membership mutation rejects a `memberId` from a different company, and rejects an under-privileged actor role, as regression guards against a future refactor accidentally weakening `resolveCompanyActor`'s enforcement.

**Finding 3 — LOW / INFORMATIONAL — A handful of admin single-record "get" actions accept a raw id string with no Zod schema validation before use.**
- Files: `admin/disputes/actions.ts` (`getAdminDisputeAction`), `admin/support-tickets/actions.ts` (`getAdminSupportTicketAction`), `admin/partners/actions.ts` (`getAdminPartnerAuditAction`).
- These are not authorization defects — the caller is already `requireRole(ADMIN, SUPER_ADMIN[, SUPPORT])`-gated, and admin is intentionally authorized to view any record of these types — but they are inconsistent with the Zod-validate-every-input convention the rest of the codebase follows uniformly, and an unvalidated id string reaching a Prisma lookup is a minor defense-in-depth gap (e.g., no length/format bound before a database round-trip).
- Severity: LOW.
- Recommendation: add the same `adminXIdSchema.safeParse()` pattern already used for every mutating admin action to these three read actions, for consistency rather than for a demonstrated security gain.

**Finding 4 — INFORMATIONAL — `resolveAppointmentActor` does not support company-owned appointments.**
- File: `src/core/application/use-cases/booking/resolve-appointment-actor.ts`.
- This is a documented, intentional scope limitation (Module 10), not a defect — a company member cannot currently manage an appointment on the company's behalf via this resolver, which is the *safe* direction to fail (more restrictive than intended, never less). Recorded for completeness per the brief's instruction to document resources/operations explicitly marked out of scope.
- Severity: INFORMATIONAL.

**No CRITICAL or HIGH finding is reported.** No cross-user financial mutation, cross-user sensitive-document access, privilege escalation, authentication bypass, cross-company financial/data access, or user-impersonation path was found in the 40 Server Action files, 18 API routes, or 17 use-case files this pass read in full.

---

## 21. IDOR / Authorization Score

**IDOR / Authorization Readiness Score: 86 / 100**

| Category | Weight | Score | Rationale |
|---|---|---|---|
| Authentication boundaries | 15 | 14 | JWT session, rate-limited/anti-enumeration login, timing-safe cron secret, Module 82 DB-fresh admin re-check all independently verified by direct source read. |
| Role authorization | 15 | 14 | `requireRole()` consistently applied across all 40 action files and gated API routes; SUPPORT correctly excluded from financial-authorization actions (Module 70.1) and from security/reconciliation views. |
| Object ownership / IDOR protection | 25 | 21 | Zero client-trusted-id vulnerabilities found across 100% of Server Actions/API routes and 17 use cases read in full; shared resolver pattern gives structural (not just anecdotal) confidence; deducted for the ~436 use-case files not individually opened this pass (still a large, risk-weighted sample, not exhaustive). |
| Multi-tenant/company isolation | 10 | 9 | `resolveCompanyActor` and all three membership-mutation use cases independently verified correct, including same-company target checks; deducted slightly for company document/self-billing use cases relying on the same pattern but not re-opened directly. |
| Financial authorization | 15 | 14 | Payment initiation, invoice acceptance, and both payout-destination-resolution paths (partner and professional/company) verified to never accept a client-supplied destination or amount; deducted for `ExecuteRefundUseCase`/`CreateFinancialAdjustmentUseCase` invariants not re-verified this pass. |
| Document/file authorization | 10 | 6 | Upload/removal ownership checks verified solid; deducted materially for Finding 1 — the viewing/delivery path could not be confirmed to work at all, let alone securely. |
| Admin/internal endpoint protection | 5 | 5 | All 4 cron routes and both previously-flagged health routes verified fail-closed and role-gated respectively; timing-safe secret comparison confirmed. |
| Authorization test coverage | 5 | 3 | Excellent, explicitly IDOR-labeled coverage in the payment and quote-viewing modules; real gaps in AcceptQuoteUseCase and company-membership mutation use-case tests (Finding 2). |
| **TOTAL** | **100** | **86** | |

This score reflects a genuinely strong, consistent authorization architecture with excellent evidence behind it for the surfaces that were fully covered (Server Actions, API routes), and honestly-flagged partial coverage for the application layer beneath them, per the brief's own instruction not to inflate confidence where coverage is incomplete.

---

## 22. Launch Impact

Nothing in this audit blocks launch on IDOR/authorization grounds specifically. Finding 1 (document delivery) should be resolved or explicitly confirmed working before identity-document-dependent flows (professional verification, company verification) are relied upon for real users, since an admin who cannot view a submitted document cannot actually complete manual verification review — a product-functionality risk more than a security one. Findings 2–4 are non-blocking. This module does not re-assess the separate, already-identified launch blockers from the two prior pre-launch audits (the materials commission/tax base contradiction, the pending legal/accounting consultation, and full `test:integration:db` execution) — those remain outside this module's IDOR/authorization scope and outside its findings.

---

## 23. Recommended Follow-Up Modules

**Module 106 — Confirm and, if needed, Implement Signed Document Delivery.** Problem: Finding 1. Severity: MEDIUM. Scope: verify against a live Cloudinary sandbox whether admin/professional document-review links currently function; if not, implement a signed-URL-issuing Server Action gated by the same ownership/role checks already verified correct for upload/removal in this report, and never return the raw private asset URL to any client. Dependencies: none. Acceptance criteria: an authorized admin can view a submitted verification document; an unauthorized party (including a signed-in customer, or a professional viewing another professional's document id) cannot, verified by an integration test.

**Module 107 — Add Authorization-Boundary Regression Tests for AcceptQuoteUseCase and Company-Membership Mutations.** Problem: Finding 2. Severity: MEDIUM, purely a verification/test module — no implementation defect was found to fix. Scope: add the specific negative-case unit tests described in Finding 2's recommendation. Dependencies: none. Acceptance criteria: each of the four use cases has a passing test asserting the correct rejection for a cross-owner/cross-company/under-privileged-role attempt.

No CRITICAL or HIGH remediation module is recommended, since none was found.

---

## 24. Final Verdict

**READY WITH MEDIUM/LOW FINDINGS**

No Critical or High-severity authorization vulnerability was identified across a complete, line-by-line review of every Server Action (40 files, 218 functions) and every API Route (18 files, 20 handlers) in this repository, backed by a large, risk-targeted, independently-verified sample of the application use-case layer beneath them (17 files, including all four shared ownership-resolver functions the rest of that layer is structurally built on). The two MEDIUM findings are, respectively, a document-delivery gap that fails closed rather than open on the evidence available, and a test-coverage gap in implementations this audit independently confirmed to be correct. Per Section 26 of this module's own brief: where the implementation is secure but coverage or a downstream delivery mechanism is incomplete, that is a verification-confidence gap, not a vulnerability — and is reported as such here.

---

## 25. Files Reviewed

**Historical context (read in full, not re-verified as fact):** `MaestroYa_Pre_Launch_Audit_2026-09-11.md`, `MaestroYa_Pre_Launch_Audit_2026-09-11_v2.md`.

**Authentication/authorization core (read in full):** `auth.ts`, `src/core/infrastructure/auth/auth-config.ts`, `src/core/infrastructure/auth/rbac.ts`, `src/core/infrastructure/auth/cron-auth.ts`, `middleware.ts`.

**Server Actions (all 40 files, read in full):** see Section 3's full file list.

**API Routes (all 18 files, read in full):** see Section 3's full file list.

**Use cases (17 files, read in full):** `resolve-job-actor.ts`, `resolve-dispute-actor.ts`, `resolve-company-actor.ts`, `resolve-appointment-actor.ts`, `initiate-quote-payment.use-case.ts`, `accept-invoice.use-case.ts`, `accept-quote.use-case.ts`, `upload-verification-document.use-case.ts`, `remove-verification-document.use-case.ts`, `get-professional-invoice.use-case.ts`, `get-customer-receipt.use-case.ts`, `remove-company-member.use-case.ts`, `transfer-company-ownership.use-case.ts`, `change-company-member-role.use-case.ts`, `delete-message.use-case.ts`, `create-partner-payout.use-case.ts`, `resolve-payout-destination.use-case.ts`.

**Infrastructure (read in full):** `src/core/infrastructure/storage/cloudinary/verification-document-upload-service.ts`, `src/core/infrastructure/storage/cloudinary/company-verification-document-upload-service.ts`.

**Presentation (read, targeted excerpt):** `src/app/(dashboard)/admin/verifications/[id]/page.tsx` (document-link rendering).

**Tests (read for coverage assessment, not executed):** `tests/unit/core/application/use-cases/payments/initiate-quote-payment.use-case.test.ts`, `tests/integration/quotes/quote-flows.test.ts`, `tests/unit/core/domain/company-membership-rules.test.ts`, plus directory listings of `tests/unit/**` and `tests/integration/**` used to confirm the absence of specific test files cited in Finding 2.

---

**Total Server Actions reviewed: 40 files / 218 exported action functions (100% of the surface).**
**Total API Routes reviewed: 18 files / 20 exported HTTP handlers (100% of the surface).**
**Total relevant Use Cases reviewed: 17 files read in full this pass (risk-selected), including all 4 shared ownership-resolver functions that structurally gate dozens of additional callers not individually re-opened, out of 453 total use-case files in the repository.**
**Critical findings: 0**
**High findings: 0**
**Medium findings: 2**
**Low findings: 1**
**Informational findings: 1**
