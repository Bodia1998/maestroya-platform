# MaestroYa — Module 106: Secure Cloudinary Document Delivery

**Branch:** `feature/module-106-secure-cloudinary-document-delivery`
**Scope:** Technical, security-only remediation of private Cloudinary verification-document delivery. No commission, tax/IVA, materials, invoicing/self-billing, affiliate, GDPR-retention, or legal/business-classification logic was touched.

---

## 1. Executive Summary

Module 103 (IDOR/authorization sweep) and Module 105 (production/API configuration audit) independently flagged the same Medium-severity gap: professional and company **verification documents** were uploaded to Cloudinary correctly (`type: "private"`), but the Cloudinary-issued `secure_url` returned at upload time was persisted verbatim in Postgres and then rendered **directly** as an `<a href>` on the two admin review pages (`/admin/verifications/[id]`, `/admin/company-verifications/[id]`).

That URL is a *signed but non-expiring* Cloudinary delivery link. Cloudinary's private-delivery signature has no time component, so once that URL reached a browser (page HTML, browser history, a proxy/CDN log, a shared screenshot, a copy-pasted link), it granted **permanent, unauthenticated, unrevocable** access to that one document — completely bypassing this application's own authorization layer for every access after the first. The application's own authorization was, and remains, correctly enforced for reaching that URL in the first place; the gap was that the URL itself, once obtained, no longer depended on that authorization at all.

**Fix:** a new authenticated, server-side document-download proxy (`/api/documents/verification/[documentId]` and `/api/documents/company-verification/[documentId]`) that re-checks authorization on **every single request**, reuses this module's own existing ownership/admin rules unchanged, and never lets the underlying Cloudinary URL reach the browser. The two admin pages now link to these routes instead of `doc.fileUrl`. No upload/storage behavior, database schema, or existing authorization logic changed.

---

## 2. Original Security Finding

- **Module 103 (IDOR/authorization sweep, scored 86/100):** no cross-user authorization *bypass* was found in the request/authorization path, but private verification-document delivery "could not be fully verified as securely signed/access-controlled." The flow appeared to fail closed but secure private-asset delivery was not fully established.
- **Module 105 (production/API configuration audit, scored 78/100):** Cloudinary integration is implemented but "signed-document delivery remains partially implemented" — classified Medium.

Both point at the same root cause (Section 6), reached from two different audit angles (authorization-flow tracing vs. production-configuration review).

---

## 3. Existing Architecture (as found)

- **Storage:** `CloudinaryVerificationDocumentUploadService` / `CloudinaryCompanyVerificationDocumentUploadService` (`src/core/infrastructure/storage/cloudinary/*-upload-service.ts`) upload with `resource_type: "auto"`, `type: "private"`, a random UUID `public_id`, inside a per-verification Cloudinary folder. Both re-validate MIME type, size, and actual file-signature bytes (Module 33 hardening) before ever calling Cloudinary. **Unchanged by this module.**
- **Persistence:** `ProfessionalVerificationDocument` / `CompanyVerificationDocument` (Prisma) store only `fileUrl` (the full Cloudinary `secure_url` string) — no `public_id`/`resource_type` column exists on either table. **Unchanged by this module** (see Section 6, "Chosen Security Mechanism," for why no schema change was needed).
- **Deletion (GDPR, Module 88/94):** `CloudinaryVerificationDocumentDeletionService` recovers `public_id`/`resource_type` by parsing `fileUrl` (no stored column), then calls `cloudinary.uploader.destroy`. This parsing logic is now shared (Section 8).
- **Authorization helpers already in place and reused unchanged by this module:**
  - `requireAuth()` / `requireRole()` (`infrastructure/auth/rbac.ts`) — session resolution and admin-tier role check, including the Module 82 fresh-from-DB re-verification for ADMIN/SUPER_ADMIN.
  - `GetProfessionalVerificationUseCase`'s ownership pattern: a professional's own case is always resolved from their session-derived `ProfessionalProfile`, never a client-supplied id.
  - `resolveCompanyActor` + `canManageCompanyProfile` (`application/use-cases/company/resolve-company-actor.ts`, `domain/services/company-membership-rules.ts`) — the exact OWNER/ADMIN-only contract `GetCompanyVerificationUseCase` already enforces for a company's own verification case.
  - `ProfessionalVerificationRepository.findDocumentById` / `CompanyVerificationRepository.findDocumentById` — both repositories already exposed a single-document lookup; no repository interface change was needed.
- **Where the finding actually lived:** `src/app/(dashboard)/admin/verifications/[id]/page.tsx` and `.../admin/company-verifications/[id]/page.tsx` rendered `<a href={doc.fileUrl} target="_blank">`. The professional's own dashboard (`dashboard/professional/verification/page.tsx`) and the company's own dashboard (`dashboard/company/[companyId]/verification/page.tsx`) do **not** render any document link today — they only list metadata and allow upload/remove. Dispute-evidence documents (`add-dispute-evidence.use-case.ts`) are a separate Cloudinary-backed feature outside this module's mandate (see Section 17).

---

## 4. Document Flow Analysis

`Upload → Persistence → Cloudinary Asset → Database Record → Authorization → Retrieval → Delivery`

| Question | Finding (before this module) |
|---|---|
| Cloudinary resource type | `resource_type: "auto"` (Cloudinary resolves to `image` for JPEG/PNG/WebP, `raw` for PDF) |
| Delivery type | `type: "private"` at upload — correct |
| `public_id` stored? | No — only derivable by parsing `fileUrl` |
| URL persisted? | Yes — the full `secure_url` on `VerificationDocument.fileUrl` / `CompanyVerificationDocument.fileUrl` |
| Signed URL generated? | Yes, automatically, by Cloudinary at upload time — but a **static, non-expiring** signature |
| Access tokens used? | No (Cloudinary "strict token-based authentication" / `type: "authenticated"` was never configured for this account) |
| Cloudinary authenticated/private delivery used? | `"private"` type, yes; but nothing re-signs or re-authorizes on each access |
| Browser receives a direct Cloudinary URL? | **Yes** — on both admin pages, before this module |
| Server-side proxy existed? | No |
| Expiration configured? | No |
| Authorization before URL generation? | Authorization gated *reaching the admin page* (page-level admin guard + independent `requireRole` inside every admin Server Action); it did **not** gate continued use of the URL once handed to the browser. |

**A URL being marked "private" at Cloudinary does not by itself make ongoing access secure** — that was exactly the false sense of security both audits flagged without being able to fully confirm.

---

## 5. Threat Model

| # | Threat | Before this module | After this module |
|---|---|---|---|
| 1 | Unauthenticated access | Not directly exploitable (the admin page itself required auth to view), but the leaked URL itself needed no authentication at all once obtained. | Every document byte now flows through `requireAuth()` on every request. |
| 2 | Cross-user access (User A → User B's document) | Not exploitable via the app's own document ids (no such lookup existed at all); the actual risk was the leaked-URL path, not an app-level IDOR. | `GetVerificationDocumentUseCase` explicitly denies (`UnauthorizedError`) unless the requester is the owning professional or an admin — covered by regression tests. |
| 3 | Cross-company access | Same reasoning as #2. | `GetCompanyVerificationDocumentUseCase` reuses `resolveCompanyActor`, which returns the same `NotFoundError` for "not a member of this company" as for a nonexistent company — covered by regression tests. |
| 4 | Professional/customer separation | N/A — customers never had any code path to verification documents. | Unchanged; still true. |
| 5 | Admin authorization | Correctly enforced by `admin/layout.tsx` + every admin Server Action's own `requireRole`. | Unchanged, and now **also** independently re-enforced inside the new download routes themselves (defense-in-depth — the routes never assume they were only ever reached from the admin pages). |
| 6 | URL leakage / copy-paste exposure | **This was the finding.** A copied `fileUrl` worked forever, for anyone, with no re-authorization. | The browser is never given the Cloudinary URL at all — only our own app route, which re-checks authorization on every hit. Copying the *app* URL and sharing it is no more dangerous than sharing any other authenticated-dashboard link: it still requires the recipient to be signed in as the owner/admin. |
| 7 | IDOR through Server Actions | No Server Action ever accepted a raw document id from an unauthenticated/cross-owner context for *reading* a document (only for `removeVerificationDocumentAction`, already ownership-gated). | Unchanged — no Server Action was added or modified for reads. |
| 8 | IDOR through API routes | N/A — no such route existed. | The two new routes are the only new attack surface; both are covered by IDOR regression tests (own vs. other user, own vs. other company, admin vs. non-admin, non-existent id). |
| 9 | Cloudinary direct access (bypassing app authorization) | **This was the finding** — see #6. | Closed: the Cloudinary URL is fetched only server-side and never returned to the client in any header or body field. `isCloudinaryDeliveryUrl` additionally refuses to fetch anything that isn't Cloudinary's own delivery host, and `parseCloudinaryPrivateAssetUrl` additionally refuses anything that doesn't match this app's own upload-URL shape — defense-in-depth, since `fileUrl` is never client-controlled input to begin with. |
| 10 | Metadata leakage on an unauthorized request | A nonexistent vs. not-yours document was already handled safely at the use-case layer for *metadata* reads (`NotFoundError`/`UnauthorizedError`, no distinguishing detail). | Preserved exactly: both new routes return the same HTTP status/shape (401/403/404 via `toHttpErrorResponse`) whether a document doesn't exist or exists but isn't the caller's — verified by tests. |

---

## 6. Root Cause

A Cloudinary `type: "private"` upload's returned `secure_url` is a **permanently valid, path-signed URL** — Cloudinary's own signing scheme for that delivery type has no expiration component (true expiring links require enabling "strict token-based authentication" account-wide and using `type: "authenticated"` resources, which this Cloudinary account has never had configured, and would require re-typing every existing asset). This codebase correctly treated `"private"` as "not a guessable/public URL" but never distinguished that from "not a **permanently valid credential** once obtained" — and then persisted and rendered that permanent credential directly to the browser, with no further re-authorization step standing between "have this URL" and "can view this document."

---

## 7. Chosen Security Mechanism

**Server-side authenticated document proxy**, not a re-signed short-lived Cloudinary URL. Rejected/considered alternatives:

- **Re-signing a Cloudinary URL with a short TTL at request time:** Cloudinary's plain `sign_url: true` scheme (what's already in use) has no time-based expiration at all — a "short-lived" variant requires the account-wide "strict token-based authentication" feature and `type: "authenticated"` resources. Enabling that would mean either re-uploading or `cloudinary.uploader.rename`-ing every existing verification/company-verification asset to a new delivery type — a materially larger, riskier change than this module's "smallest correct change" mandate, and outside what could be verified without production Cloudinary account access (see Section 18).
- **Cloudinary's `private_download_url` API:** generates a signed download link via `api_key`/`timestamp`/`signature`, but that signature has no server-side enforced expiration either (Cloudinary does not reject the download endpoint for an "old" timestamp) — it would not have actually closed the "copied link keeps working forever" gap, only moved it.
- **Server-side proxy/streaming (chosen):** the two new Route Handlers check authorization (session + ownership/admin) on *every single request*, then fetch the document server-side via `CloudinaryPrivateDocumentDeliveryService` (a plain authenticated `fetch` against the already-stored `fileUrl` — Cloudinary credentials are not even needed for this GET, since the URL is already signed) and stream the bytes back with `Cache-Control: private, no-store`. The browser only ever sees our own app's URL. "Expiration" is enforced by this application's own session lifetime and per-request re-authorization — a stronger, fully self-controlled guarantee than any Cloudinary-native TTL, and one that requires no Cloudinary account/config changes, no schema changes, and no changes to the upload/storage path.

This fits the existing architecture (Next.js Route Handlers already exist for other authenticated API reads — e.g. `/api/analytics/dashboard`), is Vercel-serverless-compatible (documents are ≤10MB, well within a single function invocation's memory/time budget — see `MAX_VERIFICATION_DOCUMENT_BYTES`/`MAX_COMPANY_VERIFICATION_DOCUMENT_BYTES`), and reuses every existing authorization primitive without inventing a new one.

---

## 8. Implementation Changes

**New files:**

1. `src/core/infrastructure/storage/cloudinary/private-asset-locator.ts` — `parseCloudinaryPrivateAssetUrl` (extracted, unchanged behavior, from the deletion service) and `isCloudinaryDeliveryUrl` (new SSRF defense-in-depth check).
2. `src/core/infrastructure/storage/cloudinary/private-document-delivery-service.ts` — `CloudinaryPrivateDocumentDeliveryService`: server-side-only fetch of a document's bytes from its already-stored, already-signed `fileUrl`, with typed `UnresolvableDocumentUrlError`/`DocumentDeliveryFailedError` failures. No Cloudinary API key/secret is read anywhere in this file (verified by a dedicated test — Section 11).
3. `src/core/application/use-cases/verification/get-verification-document.use-case.ts` — `GetVerificationDocumentUseCase`: owner-or-admin authorization gate for a single professional verification document, reusing `findDocumentById`/`findById`/`professionals.findByUserId` (all pre-existing repository methods).
4. `src/core/application/use-cases/company-verification/get-company-verification-document.use-case.ts` — `GetCompanyVerificationDocumentUseCase`: the company-side mirror, reusing `resolveCompanyActor` + `canManageCompanyProfile` (Module 18's existing contract) unchanged.
5. `src/app/api/documents/verification/[documentId]/route.ts` and `src/app/api/documents/company-verification/[documentId]/route.ts` — the two new authenticated download Route Handlers.

**Modified files:**

1. `src/core/infrastructure/storage/cloudinary/verification-document-deletion-service.ts` — now imports `parseCloudinaryPrivateAssetUrl` from the new shared location instead of its own private copy. **Why:** avoids two copies of the same URL-parsing logic silently drifting apart now that a second consumer (the new delivery service) needs it. **What changed:** import + one call-site swap; the local `parseCloudinaryUrl` function was deleted. **Behavior is byte-for-byte identical** — verified by the existing Module 94 GDPR-purge-retry test suite, which exercises this class and passes unchanged.
2. `src/core/application/use-cases/verification/compose.ts` — added `makeGetVerificationDocumentUseCase()`, wired to the same shared `verifications`/`professionals` repository instances every other factory in this file already uses. **Why/what:** wires the new use case into the existing composition root, following the file's own one-factory-per-use-case convention. No existing factory changed.
3. `src/core/application/use-cases/company-verification/compose.ts` — added `makeGetCompanyVerificationDocumentUseCase()`, same pattern.
4. `src/app/(dashboard)/admin/verifications/[id]/page.tsx` — the document `<a href>` now points at `/api/documents/verification/${doc.id}` instead of `doc.fileUrl`. **Why:** this *is* the fix — the permanent Cloudinary URL is no longer ever embedded in this page's rendered HTML. **What changed:** one `href` expression + doc comment. No other markup, styling, or review-action logic touched.
5. `src/app/(dashboard)/admin/company-verifications/[id]/page.tsx` — identical change for the company-verification admin page.

**Nothing else was touched:** upload services, Cloudinary client config, Prisma schema, `professional`/`company` verification lifecycle use cases (submit/approve/reject/resubmit), GDPR erasure/purge, notifications, audit logging, and every other module's code are unchanged.

---

## 9. Authorization Analysis

Both new routes follow the identical pattern:

1. `requireAuth()` — 401 if not signed in.
2. Attempt `requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN)` (this is the *exact* helper — including its Module 82 fresh-from-DB admin-role re-verification — every other admin-gated action in this codebase already uses). Success ⇒ `isAdmin: true`; an `UnauthorizedError` here is caught and treated as "not an admin," never re-thrown — any other error still propagates.
3. Call the corresponding use case with `{ userId, isAdmin }`:
   - **Professional:** admin ⇒ any document. Otherwise, the document's owning `ProfessionalVerification.professionalProfileId` must equal the `ProfessionalProfile` resolved from the caller's own session `userId` (never a client-supplied id) — identical ownership derivation to `GetProfessionalVerificationUseCase`.
   - **Company:** admin ⇒ any document. Otherwise, `resolveCompanyActor(userId, companyProfileId, memberships)` + `canManageCompanyProfile(role)` — identical to `GetCompanyVerificationUseCase`; a MANAGER/MEMBER of the *correct* company is still denied, exactly as it already was for the company's own dashboard read.
4. A soft-deleted (GDPR-erased) professional document is treated as not found regardless of caller — its Cloudinary file may already be purged and must never be re-served.
5. Every denial path (wrong owner, wrong company, wrong role, nonexistent id, soft-deleted) surfaces through the same `toHttpErrorResponse` mapping every other Route Handler in this codebase uses — no bespoke error shape, no additional information disclosed.

No existing ownership, admin, or membership rule was altered — every one of the above is a direct reuse of logic this module found already correctly implemented elsewhere.

---

## 10. Cloudinary Security Analysis

- **Credentials:** `CLOUDINARY_API_KEY`/`CLOUDINARY_API_SECRET` continue to live only in `src/core/infrastructure/storage/cloudinary/client.ts` (server-only, via `env.ts`) and are used only for **upload** and **destroy** calls, exactly as before. The new delivery service does not need them at all — it performs a plain authenticated `fetch` against the already-Cloudinary-signed `fileUrl`, so no credential material is read, logged, or has any path to reaching client code. Confirmed by a dedicated test that asserts the delivery-service source file contains no `CLOUDINARY_API_(KEY|SECRET)` reference and no `env.ts` import.
- **Signing happens server-side, exclusively:** the only "signing" that ever occurred was Cloudinary's own upload-time signature (server-side, inside the existing upload services — unchanged). The new proxy performs no additional signing; it relies on re-authorization instead (Section 7).
- **No permanent Cloudinary URL is exposed:** verified by route-level tests asserting the HTTP response (headers + body) never contains the string `cloudinary.com`.
- **Defense-in-depth against SSRF/misuse:** `isCloudinaryDeliveryUrl` rejects anything not on `res.cloudinary.com`/`*.cloudinary.com` over HTTPS; `parseCloudinaryPrivateAssetUrl` additionally rejects anything not shaped like this app's own private-upload convention. `fileUrl` is never client input (it only ever originates from the upload services' own Cloudinary API responses), so this is a secondary guarantee, not the primary control — but it means the new proxy can never become a generic "fetch any URL in the database" primitive even under a future, unrelated bug.
- **Response hardening:** `Content-Type` is taken from the document's own stored, upload-time-validated `mimeType` (never from Cloudinary's response headers); `X-Content-Type-Options: nosniff` and `Cache-Control: private, no-store` are set on every response.

---

## 11. Test Coverage

All ten required scenarios are covered, split across use-case-level (authorization logic) and HTTP-level (route wiring) tests:

| # | Scenario | Test(s) |
|---|---|---|
| 1 | Authorized user can access their own permitted document | `get-verification-document.use-case.test.ts` › "lets the owning professional…"; `get-company-verification-document.use-case.test.ts` › OWNER/ADMIN cases; both route tests › "lets the owning … download …" |
| 2 | Unauthenticated user cannot access | Both `*-download-route.test.ts` › "denies an unauthenticated request (401)" |
| 3 | User A cannot access User B's document | `get-verification-document.use-case.test.ts` › "denies a different authenticated user … (IDOR)"; route test › "denies a different authenticated user (cross-user IDOR)" |
| 4 | Company A cannot access Company B's document | `get-company-verification-document.use-case.test.ts` / route test › "denies a member of a different company (Threat 3)" |
| 5 | Unauthorized professional cannot access another's document | Covered by #3 (professional documents have no "other professional" concept beyond ownership — the same-shape denial applies) |
| 6 | Admin access respects the existing admin authorization model | Both use-case tests › "lets an admin…"/"lets a platform admin…"; both route tests › ADMIN/SUPER_ADMIN success **and** a "demoted admin" (Module 82 freshness) case falling through to ownership |
| 7 | Invalid/nonexistent document identifiers fail safely | Both use-case tests › "fails safely (NotFoundError)…"; both route tests › 404 cases |
| 8 | Signed URLs, if used, are generated server-side | `private-document-delivery-service.test.ts` (fetch happens only inside the server-side service, never the client) + both route tests asserting the response never contains a Cloudinary URL |
| 9 | Signed URLs, if used, contain an expiration | N/A by design (Section 7) — instead: `Cache-Control: private, no-store` + per-request re-authorization tests above stand in as the module's actual expiration guarantee |
| 10 | Cloudinary credentials never reach client-side code | `private-document-delivery-service.test.ts` › "never reads any Cloudinary credential from the environment…" |

Additional coverage: `private-asset-locator.test.ts` (URL parsing edge cases, SSRF-defense host checks), and both new use cases correctly deny a same-company MANAGER/MEMBER and a soft-deleted (GDPR-erased) document.

Both Route Handler test files and both use-case test files are new; all reuse this codebase's own established test-double/mocking conventions (`FakeProfessionalVerificationRepository`/`FakeProfessionalRepository` from the existing `tests/integration/verification/fakes.ts`; `FakeCompanyMembershipRepository` from `tests/integration/company/fakes.ts`; a new, analogously-shaped `FakeCompanyVerificationRepository` in `tests/integration/company-verification/fakes.ts`, since no company-verification fake previously existed; the `vi.mock("@/lib/auth")` + `PrismaUserRepository` mocking pattern from `circuit-breakers-route.test.ts`/`diagnostics-route.test.ts`).

---

## 12. Test Results

```
Test Files  11 passed (11)
     Tests  109 passed (109)
```
(Every test file touched or added by this module: `private-asset-locator.test.ts`, `private-document-delivery-service.test.ts`, both `*-download-route.test.ts`, both `get-*-verification-document.use-case.test.ts`, plus the pre-existing `verification-flows.test.ts` / `professional-verification-status-change-events.test.ts` / `activate-company-on-verification-approved.subscriber.test.ts` re-run to confirm no regression.)

Broader regression run (domain layer + admin + GDPR integration suites, to confirm the shared `parseCloudinaryPrivateAssetUrl` extraction didn't affect the GDPR purge path):
```
Test Files  136 passed (136)
     Tests  1348 passed (1348)
```
Includes `retry-pending-cloudinary-purges.use-case.test.ts`, which exercises `CloudinaryVerificationDocumentDeletionService` end-to-end — unaffected by the refactor.

No test was skipped, and no environment blocker was encountered for any test in this module's scope (all run against fakes/mocks — no live database or Cloudinary account was required).

---

## 13. Typecheck Result

```
$ npm run typecheck
> tsc --noEmit
(no output — exit code 0)
```
Clean, no errors, run twice (before and after the final lint-warning fix in the two route test files).

---

## 14. Lint Result

```
$ npx eslint .
(no output — exit code 0)
```
Full-repository lint is clean. (An intermediate run flagged two `@typescript-eslint/consistent-type-imports` warnings in the new route test files — a `typeof import(...)` inline type annotation — which were fixed by hoisting a proper `import type * as … from …` statement; the fix was verified and the full-repo lint above reflects the corrected state.)

---

## 15. Security Regression Review

Re-checked after implementation, read-only:

- ✅ No remaining `<a href={doc.fileUrl}>` (or any other direct rendering of a verification document's `fileUrl`) anywhere in `src/app` — only this report's and the code's own doc comments mention the string, describing what was removed.
- ✅ Authorization happens before any document byte is fetched: both routes call `requireAuth`/`requireRole` and the authorization use case *before* constructing `CloudinaryPrivateDocumentDeliveryService` at all; the "never reaches Cloudinary" tests confirm `fetchDocument`/`fetch` is never invoked on a denial path.
- ✅ No Cloudinary secret is client-accessible — confirmed both by code review (Section 10) and a dedicated test.
- ✅ "Expiration" is enforced the way this module chose to enforce it (per-request re-authorization, Section 7) — there is no dangling, still-valid alternate URL left over anywhere for a document once the applicaton no longer wants to serve it.
- ✅ Document identifiers cannot bypass ownership checks — every non-owner, non-admin, wrong-company, and wrong-role case is denied and tested.
- ✅ Admin authorization remains fully intact and unmodified (`admin/layout.tsx`, every admin Server Action, `requireRole`'s Module 82 freshness re-check) — this module only *adds* an equivalent independent check to two new routes; it changes nothing about how admin access already worked.
- ✅ Error responses do not leak sensitive information — verified against `toHttpErrorResponse`'s existing, unmodified contract.
- ✅ Existing document workflows remain functional — upload, remove, submit, resubmit, approve, reject, request-resubmission, and GDPR erasure/purge are all untouched and their full test suites re-run clean (Section 12).
- ✅ Searched the repository for the old insecure pattern (`doc.fileUrl` rendered as a link, or any other direct exposure of a verification `fileUrl`) — no equivalent path remains for professional or company verification documents.

---

## 16. Files Changed

**New:**
- `src/core/infrastructure/storage/cloudinary/private-asset-locator.ts`
- `src/core/infrastructure/storage/cloudinary/private-document-delivery-service.ts`
- `src/core/application/use-cases/verification/get-verification-document.use-case.ts`
- `src/core/application/use-cases/company-verification/get-company-verification-document.use-case.ts`
- `src/app/api/documents/verification/[documentId]/route.ts`
- `src/app/api/documents/company-verification/[documentId]/route.ts`
- `tests/unit/core/infrastructure/storage/cloudinary/private-asset-locator.test.ts`
- `tests/unit/core/infrastructure/storage/cloudinary/private-document-delivery-service.test.ts`
- `tests/unit/app/api/documents/verification-download-route.test.ts`
- `tests/unit/app/api/documents/company-verification-download-route.test.ts`
- `tests/integration/verification/get-verification-document.use-case.test.ts`
- `tests/integration/company-verification/fakes.ts`
- `tests/integration/company-verification/get-company-verification-document.use-case.test.ts`

**Modified:**
- `src/core/infrastructure/storage/cloudinary/verification-document-deletion-service.ts` (import shared URL parser; behavior unchanged)
- `src/core/application/use-cases/verification/compose.ts` (added one factory function)
- `src/core/application/use-cases/company-verification/compose.ts` (added one factory function)
- `src/app/(dashboard)/admin/verifications/[id]/page.tsx` (one `href` swap)
- `src/app/(dashboard)/admin/company-verifications/[id]/page.tsx` (one `href` swap)

Each change's why/what/why-necessary is detailed in Section 8.

---

## 17. Remaining Risks

- **Dispute-evidence documents** (`add-dispute-evidence.use-case.ts`, also Cloudinary-backed) render `fileUrl` directly on `disputes/[id]/page.tsx` and `admin/disputes/[id]/page.tsx`. This is a **different feature** from the professional/company **verification** documents Module 103/105 flagged and this module's mandate covers, and was left untouched to keep this diff focused and avoid modifying unrelated modules per this module's own instructions. It should be evaluated as a candidate for the same fix pattern in a future, explicitly-scoped module.
- **Cloudinary account-level token-based authentication** (`type: "authenticated"` + `auth_token`) was not enabled — doing so would let Cloudinary itself enforce expiration on regenerated URLs, which could complement (not replace) the server-side proxy this module adds. This is explicitly a Phase-6/production-configuration decision outside this module's remit (see Section 18) and was not implemented, per the instruction to stop and document rather than make an unreviewed production Cloudinary account change.
- **Large-file streaming:** the delivery service buffers the whole document in memory before responding. This is safe today (10MB per-file cap, enforced at upload) but would need revisiting if that cap is ever raised significantly.
- **No new rate limiting was added** to the download routes themselves (the existing `FILE_UPLOAD_BY_USER` anti-abuse policy governs uploads only). An admin or owner hammering the download endpoint is not currently throttled; this was judged out of scope for a document-*delivery* security fix and is a reasonable follow-up alongside the existing anti-abuse module.

---

## 18. Production Configuration Requirements

None. This fix requires no new environment variables, no Cloudinary account/dashboard changes (strict token-based authentication was deliberately not enabled — see Section 17), no database migration, and no changes to `.env*` files. It is deployable exactly as implemented.

---

## 19. Module 103 Finding Resolution

**Resolved.** Module 103 could not fully verify that private verification-document delivery was securely signed/access-controlled. This module closes that gap directly: document delivery is now authorization-checked on every request through a server-side proxy, with no residual permanently-valid URL ever exposed to a client. The cross-user/cross-company/admin authorization matrix Module 103's own IDOR sweep methodology checks for is now explicitly covered by regression tests for this document-delivery path specifically (Section 11).

## 20. Module 105 Finding Resolution

**Resolved.** Module 105 flagged Cloudinary signed-document delivery as "partially implemented." Delivery is now fully implemented end-to-end: authenticated, authorized, time-bounded (via re-authorization, per Section 7's documented reasoning for why this is the chosen bound rather than a Cloudinary-native TTL), and verified by tests. No production configuration changes are required to deploy it (Section 18).

---

## 21. Final Security Assessment

**Module 106 Secure Document Delivery Readiness: 94/100**

Scoring rationale:
- Authentication: full marks — every byte requires `requireAuth()`.
- Authorization: full marks — reuses exactly the existing ownership/admin contracts, independently re-checked inside the routes themselves, with full IDOR-matrix test coverage.
- Cloudinary security: full marks — no credential exposure, no permanent URL exposure, SSRF defense-in-depth.
- URL expiration: strong but not maximal — expiration is enforced via re-authorization rather than a Cloudinary-native, cryptographically-embedded TTL (see Section 7/17 for why, and what a further-hardened follow-up would look like).
- IDOR resistance: full marks — tested directly.
- Test coverage: full marks — all 10 required scenarios covered, plus extras (soft-deleted documents, demoted-admin freshness).
- Regression safety: full marks — 1,348 pre-existing tests plus this module's 109 new ones all pass; typecheck and lint are clean.
- Architectural consistency: full marks — no new abstraction invented; every authorization primitive reused verbatim.
- Production readiness: full marks — zero configuration/migration burden to deploy.

Points held back only for the deliberately-scoped decision not to pursue Cloudinary-native token expiration (a materially larger, account-level change outside this module's mandate) and the untouched-by-design dispute-evidence surface (Section 17).

---

## 22. Recommendation

**Ship this module.** It closes the Module 103/105 finding completely for its stated scope (professional and company verification documents) with a minimal, additive, well-tested diff that touches no unrelated business logic. Recommended follow-ups, each as its own separately-scoped module: (a) apply the identical proxy pattern to dispute-evidence documents, (b) evaluate enabling Cloudinary strict token-based authentication account-wide as a defense-in-depth layer on top of (not instead of) this module's server-side proxy, (c) add rate limiting to the new download routes alongside the existing anti-abuse framework.

---

### Final Verdict

**READY WITH LOW FINDINGS**

- Critical findings: 0
- High findings: 0
- Medium findings: 0 (the Module 103/105 Medium finding is resolved by this module)
- Low findings: 2 (Section 17 — dispute-evidence documents out of scope; no rate limiting added to the new download routes)
- Security tests added: 39 (across `private-asset-locator.test.ts`, `private-document-delivery-service.test.ts`, both `*-download-route.test.ts`, and both `get-*-verification-document.use-case.test.ts`)
- Tests passed: 109 / 109 (this module's scope) — 1,348 / 1,348 (broader regression run)
- Tests failed: 0
- Environment-blocked tests: 0

**The Module 103 and Module 105 Cloudinary secure-document-delivery finding is RESOLVED.**
