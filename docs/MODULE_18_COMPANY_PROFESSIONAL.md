# Module 18 — Company Professional

## 1. Business purpose

Prior to this module, every `Professional` on MaestroYa was implicitly a single
individual acting alone. Module 18 lets a professional operate as a
**company/team**: multiple individual users share one public company profile,
one set of services, one portfolio, one review stream, and one verification
case, while each member keeps their own MaestroYa account, login, and
individual professional history untouched.

An individual professional and a company are two independent ways to be
listed in Discovery. A user can be an individual professional, a member of
one or more companies, or both at the same time — nothing forces a choice.

## 2. Audit finding that shaped scope

The repository already had Phase-1 scaffolding for this: a `CompanyProfile`
model, a `CompanyMember` model with an `OWNER`/`ADMIN`/`MEMBER` enum, and
cross-entity duality already wired into `ServiceRequest`/`Quote`/`Job`/
`Appointment` (each has both a nullable `professionalProfileId` and a nullable
`companyProfileId`, mutually exclusive). Module 18 therefore is **not** a
from-scratch redesign — it fills in the missing application layer (no company
use cases existed at all), extends the schema additively (new enums, new
statuses, invitations, verification, portfolio support, discovery, admin), and
wires it into routes and dashboards that did not exist yet.

## 3. Domain model

```
User ──< CompanyMember >── CompanyProfile
                              │
                              ├─< CompanyInvitation
                              ├─< CompanyVerification >─< CompanyVerificationDocument
                              └─< PortfolioItem (companyProfileId, nullable alternative to professionalProfileId)

ServiceRequest / Quote / Job / Appointment
  professionalProfileId (nullable) XOR companyProfileId (nullable)   ← unchanged pattern, already existed
```

`CompanyProfile` gained: `slug`, `contactEmail`, `contactPhone`, `addressLine`,
`city`, `province`, `postalCode`, `country`, `latitude`, `longitude`,
`status` (`CompanyStatus`), `suspendedAt`, plus relations to invitations,
verifications, and portfolio items. All new fields are nullable or have safe
defaults — no existing row requires backfill.

`CompanyMember.role` gained a fourth value, `MANAGER`, between `ADMIN` and
`MEMBER`. Membership status (`PENDING` / `ACTIVE` / `REMOVED`) is **derived**
from `invitedAt`/`joinedAt`/`removedAt` timestamps via
`deriveMembershipStatus()` rather than stored as a redundant column — the
same convention `Address` and `PortfolioItem` already use for soft deletes.

## 4. Roles and permission matrix

| Capability                          | OWNER | ADMIN | MANAGER | MEMBER |
|--------------------------------------|:---:|:---:|:---:|:---:|
| View company profile & members       | ✓ | ✓ | ✓ | ✓ |
| Edit company profile / services      | ✓ | ✓ | ✓ | – |
| Manage portfolio                     | ✓ | ✓ | ✓ | – |
| Invite members                       | ✓ | ✓ | – | – |
| Cancel invitations                   | ✓ | ✓ | – | – |
| Change a MEMBER/MANAGER's role       | ✓ | ✓* | – | – |
| Change an ADMIN's role               | ✓ | – | – | – |
| Remove a member                      | ✓ | ✓ | – | – |
| Remove the OWNER                     | – | – | – | – |
| Transfer ownership                   | ✓ | – | – | – |
| Submit / manage verification         | ✓ | ✓ | – | – |
| Suspend / reactivate (admin panel)   | platform admin only, all roles below |

\* An ADMIN can promote/demote MEMBER ↔ MANAGER but can never touch another
ADMIN or the OWNER, and can never grant OWNER or ADMIN. Only the OWNER can
create a new ADMIN or transfer ownership. The OWNER can never be removed and
never has their role changed except via an explicit ownership transfer (which
atomically demotes the outgoing owner to ADMIN and promotes the target to
OWNER). This is enforced in `company-membership-rules.ts`
(`canChangeMemberRole`, `canRemoveMember`, `canInitiateOwnershipTransfer`,
`isEligibleOwnershipTransferTarget`) — pure functions, no framework, no I/O.

## 5. Invitation lifecycle

`CompanyInvitation` has status `PENDING → ACCEPTED | DECLINED | CANCELLED |
EXPIRED`, enforced by `canTransitionInvitation()` — once a terminal state is
reached, no further transition is allowed.

Security properties, all enforced server-side, never trusting client input:

- Invitations target **existing users only**, resolved by email at creation
  time when possible; if not yet resolvable, acceptance falls back to a
  case-insensitive match against the *authenticated accepting user's own*
  email — so an invitation can never be accepted by anyone other than its
  intended recipient.
- Tokens are generated with `node:crypto`, and only a SHA-256 `tokenHash` is
  ever persisted — the raw token is never stored, matching the existing
  `EmailVerificationToken` / `PasswordResetToken` / `RefreshToken` convention.
- A partial unique index (`company_invitations_pending_unique`) prevents a
  second `PENDING` invitation to the same email for the same company at the
  database level, not just in application code.
- Expired invitations (past `expiresAt`) and cancelled/declined/accepted
  invitations are never actionable again — `isInvitationActionable()` checks
  both status and expiry before any accept/decline/cancel use case proceeds.
- Invitations can never grant the `OWNER` role (`isInvitableRole()`).

## 6. Company context (multi-company support)

No global "current company" state exists anywhere. Every company route is
scoped by `companyId` in the URL (`/dashboard/company/[companyId]/...`), and
every use case re-derives the acting member's role from the database via
`resolveCompanyActor(userId, companyId, membershipRepository)` — it looks up
the caller's own membership row for *that specific* `companyId` and throws
`NotFoundError` if no active membership exists. A user who belongs to three
companies simply visits three different URLs; nothing needs to remember
which one is "active."

## 7. Job / Request / Quote / Appointment ownership model

No changes were made here — this module discovered the dual nullable
`professionalProfileId` / `companyProfileId` foreign keys already existed on
every one of these entities from Phase-1 scaffolding, mutually exclusive by
convention (never enforced previously; left as-is since changing it was out
of scope and risks touching Modules 5–12). A company-owned job is simply a
row where `companyProfileId` is set and `professionalProfileId` is null. Which
individual member actually performed the work is out of scope for this
module and not modeled — flagged under Known Limitations below.

## 8. Reviews & Portfolio

Reviews were not touched — they already reference the job/request, which
already supports a company owner via the mechanism in §7, so a review of a
company-performed job automatically surfaces as a company review with no
schema change needed.

Portfolio (`PortfolioItem`) gained a nullable `companyProfileId` alongside the
now-nullable `professionalProfileId`, with a CHECK constraint
(`portfolio_items_owner_xor_check`) enforcing that a portfolio item belongs to
exactly one of an individual professional or a company, never both, never
neither — mirroring the existing `professional_verifications_active_unique`
partial-index pattern for "exactly one active X" rules Prisma's schema
language can't express directly. `PortfolioRepository` gained
`listByCompanyId()` alongside the existing `listByProfessionalId()`.

## 9. Company verification

A fully separate `CompanyVerification` / `CompanyVerificationDocument` model
and `VerificationCaseStatus` enum were built, deliberately **not** reusing or
renaming Module 17's `ProfessionalVerification` / `ProfessionalVerificationStatus`
— this avoids coupling a company-verification schema change to Module 17,
which remains completely untouched. The lifecycle mirrors Module 17's
case-lifecycle shape (`DRAFT → PENDING → UNDER_REVIEW → APPROVED | REJECTED`,
with resubmission support), reusing the same Cloudinary upload infra via a
new `CompanyVerificationDocumentUploadService`, and the same admin
review/approve/reject/request-resubmission pattern, wired to
`/admin/company-verifications`.

## 10. Stripe Connect

Per explicit scope decision, this module exposes the existing
`stripeConnectAccountId` field on `CompanyProfile` **read-only** — no new
Stripe API calls, no payout flow, no onboarding link generation. Building a
working company payout flow was deliberately deferred; wiring it up is listed
under Known Limitations / Deferred Work.

## 11. Admin panel

`/admin/companies` — list/search/filter, view detail, suspend, reactivate.
Reuses the existing RBAC (`requireRole`), the existing `AdminAuditLogRepository`
(new `AdminAuditAction` values: `COMPANY_CREATED`, `COMPANY_UPDATED`,
`COMPANY_MEMBER_INVITED`, `COMPANY_INVITATION_CANCELLED/ACCEPTED/DECLINED`,
`COMPANY_MEMBER_ROLE_CHANGED`, `COMPANY_MEMBER_REMOVED`,
`COMPANY_OWNERSHIP_TRANSFERRED`, `COMPANY_VERIFICATION_*`,
`COMPANY_SUSPENDED`, `COMPANY_REACTIVATED` — each mapped to the closest
existing `AuditLogAction` enum value with the concrete action preserved in
`metadata.adminAction`, same convention as every prior admin action), and the
existing `NotificationCreator` port (best-effort, never rolls back the
primary operation on failure). `/admin/company-verifications` follows the
same pattern for the verification case queue.

## 12. Company dashboard

- `/dashboard/company` — list of companies the signed-in user belongs to, plus create-company form
- `/dashboard/company/[companyId]/profile` — edit profile/services
- `/dashboard/company/[companyId]/members` — list members, change roles, remove, transfer ownership
- `/dashboard/company/[companyId]/invitations` — send/list/cancel invitations
- `/dashboard/company/[companyId]/verification` — submit/manage verification case
- `/dashboard/company/accept-invitation?token=...` — invitation landing page (accept/decline)

## 13. Discovery integration

`/professionals` now includes a companies section alongside individual
professionals, backed by new `search-companies.use-case.ts` and
`get-company-public-profile.use-case.ts`; `/companies/[id]` is the public
company profile page. Only companies with `status = ACTIVE` are discoverable
(`isCompanyDiscoverable()`).

## 14. Security model

Every company use case follows the same checklist, enforced server-side,
never trusting any client-supplied `companyId`/`memberId`/`role`/
`invitationId`:

1. `requireAuth()` — caller must be signed in.
2. The target company/invitation/verification row must exist.
3. `resolveCompanyActor()` re-derives the caller's own membership + role from
   the database for that specific company — a client can never claim a role
   or company it doesn't actually belong to.
4. Membership must be `ACTIVE` (not `PENDING`, not `REMOVED`).
5. The domain rule functions (`canChangeMemberRole`, `canRemoveMember`, etc.)
   gate the specific action against the actor's real, re-derived role.

A user probing another company's resources gets `NotFoundError` — "not yours"
is indistinguishable from "doesn't exist," matching this codebase's existing
convention (no separate `ForbiddenError` class exists anywhere in the domain).

## 15. Database changes

New migration: `prisma/migrations/20260730000000_add_company_professional_module/migration.sql`
(hand-authored — see §17). Additive only; no existing migration file was
touched. Summary:

- New enums: `CompanyStatus`, `CompanyInvitationStatus`, `VerificationCaseStatus`; `MANAGER` added to `CompanyMemberRole`; 11 new `NotificationType` values.
- `CompanyProfile`: 11 new nullable/defaulted columns + 3 new relations.
- `PortfolioItem`: `professionalProfileId` made nullable, new nullable `companyProfileId`, new CHECK constraint `portfolio_items_owner_xor_check`.
- New tables: `CompanyInvitation`, `CompanyVerification`, `CompanyVerificationDocument`.
- New partial unique indexes: `company_invitations_pending_unique` (one pending invitation per company+email), `company_verifications_active_unique` (one non-terminal verification case per company).
- New back-relations on `User`.

## 16. New use cases

- Company: create, get-for-member, list-my-companies, update, update-services, create/list/update/delete portfolio item
- Membership: list-members, change-role, remove-member, transfer-ownership
- Invitation: create, list, cancel, accept, decline
- Verification (company side + admin side): create, get, upload-document, remove-document, submit, resubmit, start-review, approve, reject, request-resubmission, list-admin, get-admin
- Admin: list-companies, get-company, suspend, reactivate
- Discovery: search-companies, get-company-public-profile

## 17. New domain rules (pure, framework-free)

`company-rules.ts` (status transitions, discoverability, slugify),
`company-membership-rules.ts` (role changes, removal, ownership transfer,
membership status derivation), `company-invitation-rules.ts` (invitation
transitions, actionability, invitable roles, token generation/hashing),
`company-verification-rules.ts` (case transitions, approval eligibility) — all
covered by unit tests in `tests/unit/core/domain/`.

## 18. Backward compatibility

No existing individual-professional table, column, enum value, use case,
route, or test was modified in a breaking way. All schema changes to shared
tables (`PortfolioItem`, `NotificationType`) are additive/nullable. Existing
individual professionals continue to: create/manage their own profile,
services, portfolio, verification, and appear in Discovery exactly as before
— none of that code path was touched.

## 19. Tests

- `tests/unit/core/domain/company-rules.test.ts`
- `tests/unit/core/domain/company-membership-rules.test.ts`
- `tests/unit/core/domain/company-invitation-rules.test.ts`
- `tests/integration/company/fakes.ts` + `company-flows.test.ts` — covers: owner cannot be removed, ownership transfer + role update, admin cannot perform owner-only actions, manager cannot manage company, member cannot manage company, duplicate membership rejected, duplicate pending invitation rejected, expired/cancelled/wrong-user invitation acceptance rejected, invalid status transitions rejected, plus full integration flows for create/update/invite/accept/reject/remove/role-change/ownership-transfer/cross-company-denial/admin-suspend-reactivate/isolation.
- `tests/integration/admin/fakes.ts` and `tests/integration/portfolio/fakes.ts` were extended (not rewritten) so existing suites keep compiling against the widened interfaces.

See §20 for why these could not be executed in this sandbox.

## 20. Known limitations / deferred work

- **No live test execution in this sandbox**: `npx vitest run` fails on a
  missing `@rollup/rollup-linux-arm64-gnu` native binary; the `npx tsx`
  fallback fails on the same class of problem (`@esbuild/darwin-arm64`
  present, `@esbuild/linux-arm64` needed) — `node_modules` here was installed
  for macOS (darwin-arm64), the sandbox is linux-arm64. This blocks vitest,
  tsx, and (per prior modules' own documented findings) Next.js's build step
  identically. Only pure-JS tools (`tsc`, `eslint`) run. This matches every
  prior module's own documented environment limitation.
- **`prisma generate` / `prisma migrate` blocked**: outbound network to
  `binaries.prisma.sh` returns HTTP 403 in this sandbox; no live Postgres
  connection either. The migration SQL was hand-authored and reviewed but not
  applied.
- **Stripe Connect** is domain-model-only (read-only field); no onboarding,
  no payout splitting, no webhook handling for companies.
- **Job/request/quote/appointment "which individual member did the work"**
  is not modeled — only "company vs. individual" ownership, per §7.
- A leftover scratch file, `verify_rules.mts`, remains at the repo root — it
  is inert (no imports, not referenced anywhere) and documented in its own
  header as safe to delete manually.
