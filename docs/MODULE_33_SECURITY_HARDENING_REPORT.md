# Module 33 — Security Hardening: Audit Report

Branch: `feature/module-33-security-hardening`. All changes below are uncommitted, left for review.

This report covers three passes: (1) the initial full-checklist audit, (2) the RLS migration + open-redirect fix pass, and (3) this pass — a full re-review against the 15-category checklist (auth, authorization, API, database, input validation, uploads, rate limiting, CSRF, HTTP headers, secrets, logging, notifications, payments, chat, OWASP Top 10) plus fixes for what it found.

## 1. Files Changed (this pass)

| File | Change |
|---|---|
| `src/shared/utils/resolve-post-login-destination.ts` | *(prior pass)* Open-redirect guard on `callbackUrl`. |
| `src/core/domain/services/notification-rules.ts` | Closed the same open-redirect gap's edge case in `isSafeActionUrl` — now also rejects the `/\evil.com` backslash form, not just `//evil.com`. Defense-in-depth only (see §3 — no untrusted input reaches this today). |
| `src/core/application/dto/dispute.dto.ts` | **New vulnerability found and fixed.** `fileUrl` on dispute evidence now requires http(s) via `isValidMediaUrl`, not just "any URL-shaped string." |
| `src/core/application/use-cases/dispute/add-dispute-evidence.use-case.ts` | Same check re-added at the use-case layer (defense in depth, matching the codebase's own established convention). |
| `src/core/application/ports/rate-limit-policies.ts` | Added `FILE_UPLOAD_BY_USER` policy (30/hour) — uploads had no rate limit at all before this. |
| `src/app/(dashboard)/profile/actions.ts` | Wired `FILE_UPLOAD_BY_USER` into `uploadAvatarAction`; also corrected a stale comment left over from the prior pass's magic-byte-sniffing fix. |
| `src/app/(dashboard)/requests/actions.ts` | Wired `FILE_UPLOAD_BY_USER` into `addServiceRequestPhotoAction`. |
| `src/app/(dashboard)/dashboard/professional/verification/actions.ts` | Wired `FILE_UPLOAD_BY_USER` into `uploadVerificationDocumentAction`. |
| `src/app/(dashboard)/dashboard/company/[companyId]/verification/actions.ts` | Wired `FILE_UPLOAD_BY_USER` into `uploadCompanyVerificationDocumentAction`. |

*(Carried over from the prior two passes, already applied: `src/core/infrastructure/storage/file-signature.ts` + the four Cloudinary upload services' magic-byte checks; `prisma/migrations/20260811000000_enable_row_level_security/migration.sql`.)*

No Prisma model was modified this pass (`FILE_UPLOAD_BY_USER` is a plain TypeScript object key, not a database enum — deliberately chosen over extending `SecurityEventType`, a real Prisma enum, precisely to avoid a schema change; see §2). No business logic, public API, or UI changed — every fix either tightens an existing validation rule or adds a rate-limit check using the exact call pattern every other rate-limited action in this codebase already uses.

## 2. Vulnerabilities Found and Fixed (this pass)

### [Medium] Stored XSS via `javascript:` URI in dispute evidence (`fileUrl`)

**Root cause:** `addDisputeEvidenceSchema` (`dispute.dto.ts`) validated `fileUrl` with plain `z.string().url()`. Zod's `.url()` accepts anything the WHATWG `URL` constructor parses successfully — and `new URL("javascript:alert(document.cookie)")` **is** a valid URL (protocol `"javascript:"`). Nothing else in the flow re-checked the scheme; `AddDisputeEvidenceUseCase` persisted whatever string it was given.

**Impact:** The stored `fileUrl` is rendered as a plain `<a href={e.fileUrl}>` link on both the dispute participants' page (`(dashboard)/disputes/[id]/page.tsx`) and the admin dispute page (`(dashboard)/admin/disputes/[id]/page.tsx`). Any authenticated dispute participant could submit `javascript:...` as "evidence"; whoever clicked that link next — the opposing party or an admin reviewing the case — would execute attacker-controlled JavaScript in the app's origin (session-cookie/DOM access). This is exactly the kind of "unsafe file name" / XSS-via-user-submitted-URL risk the brief's checklist calls out, and it's a real, previously-unfixed gap — the *file upload* services (Cloudinary) were already hardened in the prior pass, but this field never actually goes through them: it's evidence metadata the client submits directly (see the use case's own doc comment — "this use case never uploads a file itself, it only persists the URL").

**Fix:** Reused `isValidMediaUrl` (`portfolio-rules.ts`) — the same http(s)-only check this codebase already applies to portfolio media URLs — both in the Zod schema (`.refine(isValidMediaUrl, ...)`) and again inside `AddDisputeEvidenceUseCase.execute` as defense-in-depth, matching the "re-check at every layer" convention already used for Cloudinary MIME types. **Why this is correct:** it rejects `javascript:`/`data:`/`vbscript:`/any non-http(s) scheme while accepting every legitimate value the upload flow can actually produce (a Cloudinary `https://res.cloudinary.com/...` URL), so no real evidence submission is affected — verified by inspection of every current caller (only `disputes/actions.ts`) and the Zod schema's error path being additive (a new `.refine`, not a replacement of the existing `.url()` check).

### [Low] No rate limit on file-upload Server Actions

**Root cause:** `RATE_LIMIT_POLICIES` covered login, registration, password reset, service requests, quotes, messages, and reviews — but none of the four Cloudinary-backed upload actions (avatar, service-request photo, professional verification document, company verification document) had any frequency limit. File type/size were validated, but nothing stopped an authenticated account from uploading in a tight loop.

**Impact:** Resource-cost/availability risk rather than a data-exposure one — an account (or a compromised one) could run up Cloudinary storage/bandwidth costs or degrade the upload pipeline for other users. Lower severity than the items above, but squarely inside the brief's explicit "Rate Limiting → uploads" checklist item, and cheap to close correctly.

**Fix:** Added one shared `FILE_UPLOAD_BY_USER` policy (30 uploads/hour per user) and wired `antiAbuse.enforceRateLimit(...)` into all four upload actions, using the identical try/catch-`RateLimitedError` pattern every other rate-limited action (`createServiceRequestAction`, `forgotPasswordAction`, etc.) already uses. **Why one shared policy, not four:** this is a resource-cost control ("how many uploads can one account push per hour"), not a distinct business rule per feature — the existing `LOGIN_BY_EMAIL`/`LOGIN_BY_IP` pair already establishes the precedent of "one concern, named policies" over "a policy per call site."

### [Informational] `isSafeActionUrl` had the same backslash gap as the already-fixed `callbackUrl` guard

**Root cause:** Same class of bug as the open-redirect fixed in the prior pass — `isSafeActionUrl` rejected `//evil.com` but not `/\evil.com`, which some browsers normalize identically.

**Impact:** None currently — every caller of `CreateNotificationUseCase` builds `actionUrl` itself from trusted, internally-generated strings (e.g. `` `/requests/${id}` ``); no code path passes user-controlled input through this field today (confirmed by checking all 53 files that reference `actionUrl`). Fixed anyway for consistency and as a hardening measure against a future caller that might not follow that convention, at zero cost to existing behavior (both `/` and `//` cases are unaffected).

## 3. Re-Verified: No Issue Found (this pass)

Checked and confirmed clean, nothing invented:

- **Notifications spoofing/unauthorized creation:** `CreateNotificationUseCase` is never exposed as a public Server Action (confirmed no `createNotificationAction` exists anywhere) — the only callers are trusted server-side code paths that derive the recipient from the triggering event's own data.
- **Chat — conversation access:** `SendMessageUseCase`/`ListMessagesUseCase` both re-derive membership from `conversation.members.find(m => m.userId === userId)`, never trust a client-supplied claim; a non-member's `conversationId` guess surfaces as `NotFoundError`, identical to a nonexistent one.
- **Chat — attachments:** `MessageAttachment` exists only as an unused repository interface; no upload action or use case creates one — no attachment upload surface exists yet, so no validation gap to close.
- **Payments/Stripe:** `stripe/client.ts` is a bare, unused SDK singleton (confirmed no webhook route, no Connect logic, no checkout flow anywhere in `src/`) — consistent with the existing platform audit's finding that this is intentionally deferred. Nothing to secure yet; noted in §4 for when it's built.
- **CSRF:** No custom Server Action or route handler weakens Next.js's built-in Server Action Origin-check (`next.config.ts` has no `experimental.serverActions.allowedOrigins` override). The one state-changing route handler (`PATCH /api/user/language`) requires a CORS preflight for `PATCH` that a cross-origin page can't satisfy without this app opting in via CORS headers — and it doesn't set any. Logout is a proper Server Action invoked via POST (`logoutAction`), not a GET link.
- **Rate limiting elsewhere:** login/registration/password-reset (auth-config.ts, auth/actions.ts), service-request/quote/message/review creation all confirmed wired at their actual call sites, not just declared as policy constants. `EMAIL_VERIFICATION_RESEND_BY_USER` and `FINANCIAL_ADJUSTMENT_CREATE_BY_USER` are declared but unused — verified this is because neither feature (a resend-verification-email action, a financial-adjustment UI/action) exists yet anywhere in `src/app`, not a missed wiring step.
- **IDOR spot-checks:** sampled `GetSupportTicketByIdUseCase`, `UpdatePortfolioItemUseCase`, `ChangeCompanyMemberRoleUseCase` (role-elevation-sensitive) in addition to the modules already sampled in the prior platform audit — every one re-derives ownership from the session and returns an identical `NotFoundError` for "not yours" vs. "doesn't exist."
- **Command/path injection:** no `child_process`/`exec`/`spawn` usage anywhere in `src`. Uploaded files' `originalFilename` is stored purely as a display label (React auto-escapes it on render) and never used to build a filesystem path or Cloudinary `public_id` — every upload service uses `randomUUID()` for that.
- **Logout/session:** `signOut()` is only ever called from a real Server Action (`logoutAction`), invoked via POST from a form/button, not a prefetchable GET link — this was in fact already fixed for a different reason (cookie-mutation-during-render) before this module, and happens to also be the CSRF-safe shape. `RefreshToken` rows are explicitly revoked on password change/reset/account deletion (verified in `change-password.use-case.ts`, `reset-password.use-case.ts`, `delete-account.use-case.ts`).

## 4. Remaining Risks

- **RLS migration not yet applied to the live database** (from the prior pass) — this sandbox has no network path to it; apply to staging then production, and re-run Supabase Advisor to confirm.
- **Rate limiting is in-memory only** (pre-existing) — fine for one instance, silently ineffective across several; needs a Redis-backed `RateLimitRepository` before horizontal scaling.
- **Database password is a low-entropy, dictionary-adjacent string** in plaintext `.env*` files (correctly `.gitignore`d, not committed) — recommend rotating via the Supabase dashboard as hygiene.
- **CSP still allows `'unsafe-inline'`** — pre-existing, documented trade-off; needs a root-layout nonce plumbing change out of scope here.
- **No dedicated adversarial/IDOR regression test suite** — every sampled case is correct, but nothing pins the invariant down as a test.
- **When Stripe/Connect is actually built:** the webhook route must call `stripe.webhooks.constructEvent` with the signing secret (never trust an unverified request body), and should record processed event IDs (the schema's existing `idempotencyKey` pattern, already used by `FinancialAdjustment`) to reject replays. Flagging now so it isn't missed when that module starts — nothing to fix today since no webhook exists yet.
- **`package.json#prisma` seed config is on Prisma's deprecated path** ahead of a future Prisma 7 upgrade — unrelated to this module, carried over from the existing platform audit.

## 5. Validation Results

| Command | Result |
|---|---|
| `npx prisma generate` | **Failed — environmental**, not code: `403 Forbidden` fetching the `schema-engine` binary for `linux-arm64` from `binaries.prisma.sh`. No network path to Prisma's binary CDN from this sandbox. |
| `npx prisma migrate status` / `deploy` | **Failed — environmental**, same root cause; no DB connection available from this sandbox either. |
| `npm run lint` | **Passed**, zero errors/warnings. |
| `npx tsc --noEmit` (`npm run typecheck`) | **Passed**, zero errors. |
| `npm test` (`vitest run`) | **Failed — environmental**, not code: `Cannot find module '@rollup/rollup-linux-arm64-gnu'` — this sandbox's ARM64 Linux can't resolve/download the native Rollup binary. |
| `npm run build` (`next build`) | **Failed — environmental**, not code: `Failed to load SWC binary for linux/arm64`, same root cause. |

All four failures match the exact failure signatures recorded in the project's own prior platform audit (`MaestroYa_Audit_Report.md`, §13) and the two earlier passes of this module — this sandbox cannot fetch platform-native binaries for Rollup, SWC, or Prisma's engines. `lint`/`typecheck` (pure JS/TS) ran cleanly both times. **Re-run `prisma generate`, `prisma migrate deploy`, `npm test` (including the extended `resolve-post-login-destination.test.ts` and the still-untested dispute-evidence URL validation), and `npm run build` in the real dev/CI environment before merging.**

Nothing was committed or pushed. All changes remain in the working tree on `feature/module-33-security-hardening` for review.
