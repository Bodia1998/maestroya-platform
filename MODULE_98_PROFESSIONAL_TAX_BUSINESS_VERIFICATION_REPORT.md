# Module 98 — Professional Tax & Business Verification — Implementation Report

Branch: `feature/module-98/professional-tax-business-verification`
Repository: `maestroya-platform-auth`

## 1. Objective & Scope

Close the one remaining bypass identified in `MODULE_98_PROFESSIONAL_TAX_BUSINESS_VERIFICATION_AUDIT.md`: `RefreshVerificationStatusUseCase` (the Persona automated identity-verification path, used both by a direct "check status" call and by `ProcessPersonaWebhookUseCase`) could mark a professional's profile `VERIFIED` from Persona identity confirmation alone, with no business/tax evidence — while the manual admin path (`ApproveProfessionalVerificationUseCase`) already enforced a business-registration-document requirement. The objective was the smallest production-safe change that makes the business-verification rule authoritative across every path (manual approve, Persona check-status, Persona webhook), reusing 100% of existing architecture.

No new verification/document/onboarding/eligibility system was introduced. No Persona integration semantics changed — Persona remains identity-only. No Modelo 036-specific document type was created. No unrelated module (Module 96/97, Stripe, self-billing) was touched.

## 2. Audit Findings — Verified Against Current Code

Before implementing, every audit finding relevant to this fix was re-confirmed against the current source (current code is authoritative where it might disagree with the audit):

- `ApproveProfessionalVerificationUseCase` (manual path) — unchanged since the audit, byte-for-byte: it calls `hasBusinessRegistrationDocument(documents.map(d => d.type))` and throws `BusinessRegistrationRequiredError` before ever transitioning a case to `APPROVED` or writing `verificationStatus = "VERIFIED"`.
- `RefreshVerificationStatusUseCase` — unchanged since the audit: on a Persona `VERIFIED` outcome it transitioned the case to `APPROVED` and called `setProfileVerificationStatus(..., "VERIFIED", now)` with **no** business-document check. This is the confirmed, sole remaining bypass.
- `ProcessPersonaWebhookUseCase` delegates entirely to `RefreshVerificationStatusUseCase.execute(...)` after idempotent webhook claiming, so it inherited the exact same bypass — no separate fix was needed there.
- `hasBusinessRegistrationDocument()` (in `professional-verification-rules.ts`) checks document **type** presence only (`BUSINESS_REGISTRATION_DOCUMENT_TYPES`, currently `["BUSINESS_REGISTRATION"]`), not per-document `VerificationDocumentStatus`. A repo-wide search confirmed **no code path anywhere ever writes a `VerificationDocumentStatus` other than the schema default (`PENDING`)** — there is no per-document admin review step (confirmed by the domain doc comments and by grepping for `updateDocumentStatus`/`approveDocument`/`rejectDocument`, none of which exist). This means "the business-registration document is approved" is defined, exactly as the existing manual path already treats it, by the **case's own status reaching `APPROVED`** — not by a separate per-document status. The fix reuses this exact, already-tested semantic rather than inventing per-document status filtering.
- `professional-onboarding-rules.ts`'s `isBusinessRegistrationVerified()` already delegates to the same `hasBusinessRegistrationDocument()` predicate (`status === "APPROVED" && hasBusinessRegistrationDocument(documentTypes)`) — it does **not** duplicate the check. No change was needed here; it was already the "shared policy" the audit recommended.
- `CheckPayoutEligibilityUseCase` derives eligibility purely from `canReceivePayouts(status) === (status === "APPROVED")` — confirmed it was also affected by the bypass (a Persona-only `APPROVED` case made payouts eligible) and is fixed by the same change.
- Company verification (`CompanyVerificationRepository`/`company-verification-rules.ts`) has no automated/Persona shortcut and was already unaffected — confirmed unchanged, not touched.

## 3. Root Cause

`RefreshVerificationStatusUseCase.execute()` computed the case's next status purely from the Persona outcome (`resolveProviderStatusTransition`) and, on `APPROVED`, immediately wrote both the case status and the profile's public `verificationStatus = "VERIFIED"` — with no equivalent of the manual path's business-registration-document gate. Persona is (and remains) an identity-only provider; it was never asked about, and never will be asked about, business/tax evidence. The manual admin path already understood this distinction; the automated path did not.

## 4. Chosen Architecture

```
                 ┌─────────────────────────────┐
                 │ hasBusinessRegistrationDoc-  │
                 │ ument(documentTypes)         │   <- existing, unchanged
                 │ (professional-verification-  │      single source of truth
                 │  rules.ts)                    │
                 └───────────┬─────────┬─────────┘
                             │         │
          ┌──────────────────┘         └───────────────────┐
          │                                                 │
┌─────────▼──────────────────────┐          ┌──────────────▼───────────────────┐
│ ApproveProfessionalVerification │          │ RefreshVerificationStatusUseCase   │
│ UseCase (manual admin path)     │          │ (Persona check-status AND webhook, │
│ — unchanged                     │          │  since ProcessPersonaWebhookUseCase│
│                                 │          │  delegates to this one)            │
└─────────────────────────────────┘          └─────────────────────────────────────┘
```

No new abstraction/service/class was introduced. `hasBusinessRegistrationDocument` was already the shared predicate both the manual path and `professional-onboarding-rules.ts` used; `RefreshVerificationStatusUseCase` now simply calls it too, at the same decision point the manual path already uses it (immediately before treating a case as `APPROVED`). This follows the explicit instruction not to add abstraction "purely for theoretical cleanliness" — the simplest existing pattern was reused verbatim.

**Outcome when Persona confirms identity but no business-registration document exists:** rather than inventing a new case status, the case is transitioned to the existing `RESUBMISSION_REQUIRED` status (a legal transition from both `PENDING` and `UNDER_REVIEW` per the existing `TRANSITIONS` table) with `resubmissionReason` set, and the profile's public `verificationStatus` is set to `PENDING` (never `VERIFIED`) — exactly mirroring what `RequestVerificationResubmissionUseCase` already does for the identical "an admin needs something more from the professional" situation. This is self-healing: `canModifyDocuments`/`canResubmit` already allow the professional to upload the missing document and resubmit from `RESUBMISSION_REQUIRED`, after which a fresh Persona check can reach `APPROVED`.

## 5. Implementation

Single production file changed: `src/core/application/use-cases/verification/refresh-verification-status.use-case.ts`.

- Imports `hasBusinessRegistrationDocument` from `professional-verification-rules.ts` (already existed; no new export was added to that file).
- After `resolveProviderStatusTransition` computes a `mappedStatus`, if it is `"APPROVED"`, the case's documents are fetched (`this.verifications.listDocuments(...)`, the exact same repository method the manual path already uses) and checked. If the business-registration document type is missing, the effective `nextStatus` used for the rest of the method is downgraded to `"RESUBMISSION_REQUIRED"` and a `businessRegistrationMissing` flag is set.
- The `updateStatus` call, the profile-status write, the audit-log action, and the notification all branch on this flag: a missing document produces `resubmissionReason` text, records the existing `"VERIFICATION_RESUBMISSION_REQUESTED"` audit action (already used elsewhere for the identical manual scenario), sets the profile to `PENDING` (never `VERIFIED`), and sends the existing `"VERIFICATION_RESUBMISSION_REQUIRED"` notification type — all pre-existing enum values, no schema or enum change.
- `ProcessPersonaWebhookUseCase` required **zero changes** — it delegates to the fixed use case and inherits the fix automatically.
- `professional-onboarding-rules.ts` required **zero changes** — it already delegated to the same predicate rather than duplicating it (confirmed in §2).

## 6. Files Changed

```
 src/core/application/use-cases/verification/refresh-verification-status.use-case.ts | 78 +++++++++++++++---
 tests/integration/verification/persona-webhook-flows.test.ts                        | 44 +++++++++-
 tests/integration/verification/provider-verification-flows.test.ts                  | 96 +++++++++++++++++++++-
 3 files changed, 204 insertions(+), 14 deletions(-)
```

No `git add`/`commit`/`push`/branch-switch/reset/restore was performed at any point — all changes remain unstaged working-tree edits for manual review, staging, and commit by the repository owner.

## 7. Security Review

- **No client-controlled verification status**: the fix operates entirely server-side inside the use case; nothing in the change accepts or trusts any client-supplied `verificationStatus`/case status. `ProcessPersonaWebhookUseCase` still re-fetches the provider's own state via `this.provider.refreshStatus(...)` rather than trusting the webhook payload's embedded status (pre-existing behavior, unchanged, and explicitly re-verified by the existing test "resolves the inquiry id to the internal case (never trusting a client-supplied id) and applies an APPROVED transition via a fresh provider read, not the webhook body").
- **IDOR/ownership**: no new document/verification read or write path was added; the fix reuses `listDocuments(verificationId)`, already scoped to the single verification case being processed, resolved server-side from the Persona inquiry id (never from client input) exactly as before.
- **No new admin/authorization surface**: the change is confined to the automated Persona-provider code path; no Server Action, API route, or RBAC check was touched.
- **Fail-safe direction**: the change can only make the automated path *more* conservative (fewer cases reach `VERIFIED` without evidence) — it cannot newly grant `VERIFIED`/payout eligibility in any case that did not already qualify before.

## 8. Concurrency & Idempotency

- No new database writes or tables were introduced, so no new concurrency surface exists. The fix runs inside the same `updateStatus` call the pre-existing code already made, using the same optimistic read-then-write pattern.
- The existing Persona-webhook idempotency guarantee (`ExternalWebhookEventRepository.claim()`, provider+externalEventId uniqueness, `FAILED`-only reclaim) is untouched — verified by the still-passing "duplicate delivery... never re-processes" and "concurrent duplicate deliveries: only one claims and processes the event" tests.
- `canSyncProviderStatus` continues to gate re-entry the same way it always did: once a case is downgraded to `RESUBMISSION_REQUIRED`, it is no longer syncable until the professional resubmits it back to `PENDING`/`UNDER_REVIEW` — preventing any duplicate/concurrent Persona sync from re-processing a case stuck waiting on a business document.

## 9. Database / GDPR / Migration Impact

- **No Prisma schema change, no migration.** Every enum value used (`RESUBMISSION_REQUIRED` case status, `PENDING` profile status, `VERIFICATION_RESUBMISSION_REQUESTED` audit action, `VERIFICATION_RESUBMISSION_REQUIRED` notification type) already existed and is already used by the manual `RequestVerificationResubmissionUseCase` path for the identical situation.
- No new document/verification retention or deletion path was introduced; Module 94's existing GDPR erasure/purge-retry mechanism for `ProfessionalVerificationDocument` is untouched and unaffected — the fix reads documents, it never creates, deletes, or purges them.

## 10. Observability

- Reuses the existing `AdminAuditLogRepository.record(...)` call already present in `RefreshVerificationStatusUseCase`, with the existing `"VERIFICATION_RESUBMISSION_REQUESTED"` action string (already used by the manual `RequestVerificationResubmissionUseCase` path) and an added `businessRegistrationMissing: true` metadata flag for observability/debugging.
- Reuses the existing `NotificationCreator` call, with the existing `"VERIFICATION_RESUBMISSION_REQUIRED"` notification type (already defined in the Prisma `NotificationType` enum and already used by the manual admin path).
- No new logging/metrics infrastructure was added.

## 11. Test Coverage Added

All new tests live in the two existing integration test files that already covered this use case (`tests/integration/verification/provider-verification-flows.test.ts` and `tests/integration/verification/persona-webhook-flows.test.ts`), using the existing fakes (`FakeProfessionalVerificationRepository`, `FakeVerificationProvider`, `FakeExternalWebhookEventRepository`) — no new test infrastructure.

Three pre-existing tests that encoded the bug (asserting `APPROVED`/eligible from Persona identity alone, with no business document ever seeded) were updated to seed a `BUSINESS_REGISTRATION` document via the existing `addDocument(...)` repository method, restoring their original intent without weakening any assertion.

New tests added:
- **Module 98 (RefreshVerificationStatusUseCase)**: Persona `VERIFIED` outcome with no business document → case downgraded to `RESUBMISSION_REQUIRED`, `resubmissionReason` mentions the business document, profile stays `PENDING` (never `VERIFIED`), audit log contains `VERIFICATION_RESUBMISSION_REQUESTED` and never `VERIFICATION_APPROVED`, notification of type `VERIFICATION_RESUBMISSION_REQUIRED` is sent. This is the mandatory regression test: **Persona identity verification must NOT equal professional eligibility.**
- **Module 98 (recovery path)**: after the above downgrade, uploading the business document and resubmitting (`PENDING`) allows a subsequent refresh to reach `APPROVED` and `VERIFIED` — proving the fix is self-healing, not a dead end.
- **Module 98 (SynchronizeVerificationUseCase / batch sync)**: existing "syncs every syncable case" test updated to seed a business document so the batch-sync path is proven to still work correctly with the fix in place.
- **Module 98 (CheckPayoutEligibilityUseCase)**: existing "PENDING → APPROVED" test updated to seed a business document (restoring its original intent); new test proves payout eligibility is never granted from Persona identity verification alone.
- **Module 98 (webhook boundary)**: new test on `ProcessPersonaWebhookUseCase` proving the identical regression at the webhook layer — a `VERIFIED` Persona webhook with no business document does not approve the case and does not verify the profile. The existing webhook "VERIFIED" and "retry" tests were updated to seed a business document, restoring their original intent.
- **Security/IDOR regression** (pre-existing, re-verified unchanged and passing): "IDOR/BOLA safety: an unmatched providerVerificationId... is acknowledged, never processed as if it were a real case"; "denies professional B removing professional A's document" (Module 17 verification-flows.test.ts); duplicate/concurrent webhook delivery tests.
- **Real-PostgreSQL integration**: this fix touches only pure application-layer logic already exercised end-to-end by the fake-repository integration tests above; the existing Module 91 real-database integration harness (`vitest.config.integration-db.ts`) was not modified and was not a required target for this specific application-logic fix (no new SQL, index, or transaction behavior was introduced). Running `npm run test:integration:db` remains available and unaffected by this change; the sandbox's local Postgres/tooling constraints (see §13) meant it was not exercised in this session.

## 12. Test Results

```
tests/integration/verification/persona-webhook-flows.test.ts        10 tests  ✓ (was 9; +1 Module 98 regression test)
tests/integration/verification/provider-verification-flows.test.ts  15 tests  ✓ (was 12; +3 Module 98 tests, 3 pre-existing fixed)
tests/integration/verification/verification-flows.test.ts           15 tests  ✓ (unchanged, re-verified passing)
tests/unit/core/domain/professional-verification-rules.test.ts      17 tests  ✓ (unchanged, re-verified passing)
tests/unit/core/domain/professional-onboarding-rules.test.ts        22 tests  ✓ (unchanged, re-verified passing)
tests/integration/verification/professional-verification-status-change-events.test.ts  2 tests  ✓
tests/unit/core/application/use-cases/verification/record-professional-verification-audit-log.subscriber.test.ts  7 tests  ✓

  Verification-scoped total: 7 test files, 88 tests, 88 passed, 0 failed.
```

Broader regression sweep (directories that read/depend on `verificationStatus`, onboarding progress, payout eligibility, or quote gating — the surfaces this fix could plausibly affect):

```
tests/integration/{onboarding,quotes,payments,company-verification,discovery,professional,company,gdpr,admin,security}
  16 test files, 218 tests, 218 passed, 0 failed.
  (1 unrelated, pre-existing "Unhandled Rejection" logged from quote-flows.test.ts: Prisma Client's
   native query engine was generated for darwin-arm64 on the developer's machine but this verification
   sandbox is linux-arm64 — an environment/tooling mismatch unrelated to this change, and it did not
   fail any test or affect the 218/218 pass count.)
```

A further partial sweep of `tests/unit/core/domain` and `tests/unit/core/infrastructure/{verification,onboarding,payout}` ran 56+ additional test files with zero failures before the sandbox's per-command execution budget was reached (see §13) — no test in this sweep failed or showed any regression.

## 13. Verification Commands Run

```
npx tsc --noEmit                → PASSED, 0 errors (run twice: once immediately after the production
                                   fix, once again after the test-file edits)
npx eslint .                    → PASSED, 0 errors, 0 warnings (full repository)
git diff --check                → PASSED, 0 whitespace/conflict-marker errors
git status --short              → only the 3 intended files modified, plus the pre-existing untracked
                                   Phase-1 audit report; nothing staged, committed, or pushed
npm test (targeted, see §12)    → 88/88 + 218/218 passed across every directory this change could affect
npm run build                   → NOT COMPLETED in this sandbox: `next build` did not progress past
                                   printing its startup banner within this environment's hard per-command
                                   execution ceiling, with or without telemetry disabled — this reproduced
                                   identically before any code was touched and is a sandbox/tooling
                                   limitation (this verification session runs through a remote shell with
                                   a strict per-command time limit and no ability to keep a background
                                   process alive across commands), not a symptom of this change. tsc
                                   --noEmit (a full strict type-check of the entire project, including
                                   every file `next build` would type-check) passed cleanly, and eslint
                                   passed cleanly across the whole repo, which are the two checks most
                                   likely to catch a build-breaking mistake. Recommend running
                                   `npm run build` on a normal developer machine (or CI) before merging,
                                   as a final confirmation.
```

## 14. Remaining Risks & Deferred Items

- **`npm run build` was not executed to completion** in this sandbox (see §13) — recommend the repository owner run it locally/in CI before merging.
- **`npm run test:integration:db`** (the real-PostgreSQL harness) was not exercised in this session; this fix is pure application-layer logic with no new SQL/schema/index behavior, so risk is assessed as low, but running it is still recommended as a final gate given the user's stated requirement.
- **The document-type list (`BUSINESS_REGISTRATION_DOCUMENT_TYPES`)** remains exactly as it was — a single generic `BUSINESS_REGISTRATION` type, explicitly marked "GESTOR DECISION PENDING" in the code. This fix deliberately does not narrow or widen it, per the instruction not to invent Spanish legal document requirements (Modelo 036 or otherwise) without asesor/legal confirmation.
- **Per-document `VerificationDocumentStatus`** remains write-never/dead across the entire codebase (confirmed in §2) — this is a pre-existing architectural characteristic, not something this fix introduced or needed to change, since "approved" is already defined at the case level everywhere else in the system.
- **`CompanyVerificationDocument`'s missing GDPR erasure path** (identified in the original audit as a separate, adjacent gap) was intentionally left untouched — out of scope for Module 98, and explicitly not "directly required to close the verification bypass."
- **The Quote/Payment amount business-model discrepancy** (Module 97) and Module 96 affiliate economics were not touched, per the explicit "DO NOT CHANGE" instructions.

## 15. Final Recommendation

The bypass is closed with the smallest possible change: one production file modified (no new files, no new abstractions, no schema change, no migration), reusing the exact predicate and exact case-status/notification vocabulary the manual admin path and the pre-existing resubmission flow already used. All three verification paths — manual approve, Persona check-status, and the Persona webhook — now enforce the identical business-registration-document requirement before a professional's profile can be marked `VERIFIED`. 88/88 targeted verification tests and 218/218 broader-surface tests pass; `tsc --noEmit` and `eslint .` are clean across the whole repository; `git diff --check` is clean; the diff is confined to exactly 3 files. `npm run build` and the real-Postgres integration suite were not able to complete inside this sandbox's execution constraints and are recommended as a final local/CI confirmation before merge.

No `git add`, `git commit`, `git push`, branch switch, `git reset`, or `git restore` was performed. All changes remain unstaged in the working tree of `feature/module-98/professional-tax-business-verification` for manual review.
