# Module 158 — GDPR, Consent & Retention Integration (LEAD_V1)

Status: implemented on `feature/module-158/gdpr-consent-retention-integration`. **Default behaviour is unchanged** until the two open legal decisions below (D19, D20) are made and configured. This document describes engineering behaviour. It is **not** a statement of legal compliance and nothing here replaces review by counsel / the DPO.

## 1. What this module is — and is not

M158 connects the existing GDPR machinery (export, account erasure/anonymization, audit) to the LEAD_V1 lead lifecycle, and adds the minimum new state needed: a per-lead record of the **lawful basis on which the customer's contact details may be shared with purchasing professionals**.

It does **not**: create a second consent system, change legacy quote/payment/commission/payout/settlement flows, touch M154–M157 code, hard-delete anything, invent retention periods, or weaken M138/M139 contact authorization. Consent is *one* possible basis, never assumed to be the only one, and acceptance of the Terms of Service is never treated as consent.

## 2. Existing mechanisms reused

- `User.personalDataErasedAt` + `PrismaUserRepository.eraseAccount` (user row is anonymized, never deleted) and `ExecuteAccountErasureUseCase`.
- `GdprDataInventory` / personal-data export.
- `AuditLog` via `AdminAuditLogRepository` — only the **existing** actions `GDPR_CONSENT_GRANTED`, `GDPR_CONSENT_WITHDRAWN`, `GDPR_DELETION_EXECUTED` are used (no new audit vocabulary).
- `ServiceRequestRepository.updateStatus` + `propagateServiceRequestStatusToLead` (M130): cancelling a request cancels its lead in the same transaction.
- M138/M139 contact ports (single reviewed adapter file), `createDistributedLock`, the cron-route pattern, the guarded PG integration harness.

## 3. Lawful basis & consent

`LEAD_CONTACT_SHARING_BASIS` (env, exact):

| Value | Meaning |
|---|---|
| unset | **Undecided (default).** Behaviour exactly as before M158. No record is required or created. |
| `CONSENT` | Publishing a lead requires an explicit `contactSharingAccepted === true`; a `CONSENT` evidence row is written. Contact is released only while that row exists and is not withdrawn. |
| `OTHER_LAWFUL_BASIS` | An evidence row with that basis is written (best effort). No consent semantics; **withdrawal is not applicable** (the customer's recourse is erasure / objection, handled outside this module). |
| anything else | Invalid → fails closed to `CONSENT`, with a value-free warning. |

`LEAD_CONTACT_SHARING_NOTICE_VERSION` (≤ 64 chars, `[A-Za-z0-9._:-]`) is the identifier of the notice text shown. It is supplied by the **server** configuration, never by the client.

Evidence table `lead_contact_sharing_records`: one row per lead (`leadId` UNIQUE), `userId`, `basis`, `noticeVersion`, `recordedAt`, `withdrawnAt`. Minimal by design: no IP, user agent or free text. DB-enforced: evidence columns are immutable; `withdrawnAt` is write-once and only valid for `CONSENT`; rows are never deleted; the user must own the lead; RESTRICT foreign keys; RLS enabled with REVOKE from public roles. **No backfill:** existing leads and users get no row, so nobody is silently converted into a consenting user.

Withdrawal (`CONSENT` only): stamps `withdrawnAt`, cancels the request and its lead (same transaction path as any cancellation), and contact is denied from then on. It is effective for **future** processing only; it does not claw back contact already released, and does not refund buyers (see §8).

## 4. Contact access (data minimization)

`PrismaLeadContactAuthorizationReader` / `PrismaLeadContactReader` now also deny when (a) the customer has been erased, or (b) the sharing gate denies (CONSENT policy with no record, or any withdrawn consent — withdrawal wins even if the deployment later switches basis). Denial is the existing uniform `LeadContactAccessDeniedError` — no distinguishing message, no PII. Access is still derived from a `CONFIRMED` purchase belonging to the caller; consent never grants access by itself. The M157 admin reader still selects no contact columns; the new code selects none either (pinned by a boundary test).

## 5. Retention, erasure & anonymization

Cron: `GET /api/cron/lead-privacy-retention` (daily 04:20 UTC, `CRON_SECRET` bearer, 503 if unset, `?dryRun=1` for a no-write run). Bounded (`LEAD_PRIVACY_BATCH_SIZE`, default 100, max 500; ≤ 10 batches per phase), distributed-lock protected, `FOR UPDATE OF … SKIP LOCKED` claims, idempotent, counts-only responses, any failed phase → HTTP 500 + operator message.

| Data category | Where | M158 behaviour |
|---|---|---|
| Customer identity | `users` (anonymized in place by erasure) | Unchanged (existing). |
| Request free text (title, description) of an **erased** customer's LEAD_V1 requests | `service_requests` | Replaced by `[erased]`, request soft-deleted, open request/lead cancelled. Runs inside the erasure use case (best effort, never undoes the erasure) **and** in the sweep (retry/backfill). |
| Request free text of **terminal** leads (CLOSED/EXPIRED/CANCELLED) | `service_requests` | Replaced by `[erased]` only if `LEAD_REQUEST_CONTENT_RETENTION_DAYS` is configured, `leads.updatedAt` ≤ cutoff, and no purchase in `PENDING_PAYMENT`/`CONFIRMED`/`DISPUTED`. Unset/invalid → nothing. |
| Purchases, fee ledger, invoices, credit notes, refunds, disputes, claims, revocations | M123–M155 tables | **Never modified** by M158. |
| Audit history | `audit_logs` | Never modified; M158 entries hold ids, enums, versions and counts only. |
| Contact-sharing evidence | `lead_contact_sharing_records` | Kept (it is the evidence of basis/withdrawal). Included in the personal-data export when wired. |
| Abuse signals (M156), claim / dispute free text, request photos + Cloudinary files | respective tables | **Not covered** — see §8. |

No statutory or contractual retention period is encoded. Financial/dispute/audit preservation is by *not touching* those tables, not by a computed period.

## 6. Lifecycle integration

- Publication under `CONSENT` with no acceptance: refused before anything is created. With acceptance: if the evidence write fails the request is cancelled and the failure surfaces (nothing is published without evidence).
- Account erasure: step "1b" anonymizes the user's LEAD_V1 requests and cancels their leads (which feeds the M155 access consequences through the normal lead status path); retries are safe.
- Legacy (`LEGACY_QUOTE_PAYMENT`) requests and flows are never selected or modified; boundary tests pin this.

## 7. Configuration summary

| Variable | Default | Notes |
|---|---|---|
| `LEAD_CONTACT_SHARING_BASIS` | unset (undecided) | `CONSENT` \| `OTHER_LAWFUL_BASIS` |
| `LEAD_CONTACT_SHARING_NOTICE_VERSION` | unset | required for the basis to be recordable |
| `LEAD_REQUEST_CONTENT_RETENTION_DAYS` | unset (no minimization) | integer 1–36500 |
| `LEAD_PRIVACY_BATCH_SIZE` | 100 | max 500 |
| `CRON_SECRET` | — | existing |

## 8. Reported limitations — classification (final hardening)

| # | Item | Classification | Status |
|---|---|---|---|
| 1 | Submit action did not forward `contactSharingAccepted` | Defect (plumbing only) | **Fixed:** the server action forwards a literal boolean `true` only (anything else is `false`); the notice version still comes from server config. **No UI control or notice copy was added** — the checkbox text is the D19 notice. |
| 2 | Enabling `CONSENT` before notice copy + UI refuses new publications | Deferred (D19) — intentional fail-closed | Unchanged. Do not set `LEAD_CONTACT_SHARING_BASIS=CONSENT` until the approved copy and UI ship. |
| 3 | Existing published leads have no evidence row | Deferred (D19) — backfilling would be silent consent | Unchanged. Under `CONSENT` such leads are neither purchasable nor releasable until their customer consents; under undecided/`OTHER_LAWFUL_BASIS` they are unaffected. The sweep reports the count. |
| 4 | Purchase initiation not gated | **Defect** (a buyer could pay for access that is always denied) | **Fixed:** `guardLeadPurchaseByContactSharing` (decorator in the lead-purchase composition root; the use case and its pinned constructor are untouched) uses the same `decideContactSharing` decision as the contact readers. Undecided policy = no check and no read. Denial is the uniform `LeadNotPurchasableError`; an open PENDING_PAYMENT retry is gated too; a read failure fails closed. |
| 5 | No retention for photos / Cloudinary, abuse signals, claim and dispute free text | Deferred (D20) / out of scope — needs approved periods, and claims/disputes/abuse tables belong to M154–M156 | Unchanged, documented. |
| 6 | Refund policy when access is revoked after payment | Deferred (business decision, M153/D12) | Unchanged. Nothing refunds automatically. |
| 7 | `OTHER_LAWFUL_BASIS` has no withdrawal flow | Deferred (legal): objection / erasure rights under a non-consent basis are a D19 outcome, not a consent toggle | Unchanged; erasure already blocks contact. |

Open decisions (not made by engineering): **D19** — lawful basis for disclosing contact details to buyers, and the notice text/versioning; **D20** — retention periods per category; and the refund entitlement in item 6.

Rollout order that is safe today: leave `LEAD_CONTACT_SHARING_BASIS` unset (behaviour unchanged) → after D19: ship the approved copy + UI checkbox first, set the notice version, then set the basis. Only leads published after that point carry evidence.

Other limitations: sold leads (blocking purchase states) are never minimized; the purchase gate is evaluated at initiation, so a buyer who already paid keeps a paid-but-denied purchase if consent is withdrawn later (item 6).

## 8a. Migration

`20261026000000_add_module_158_lead_contact_sharing_records` follows the repository's convention: M155/M156 migrations already use `20261020…`–`20261025…` (one per day, ahead of the calendar date), and this one is the next free slot after the last M156 migration. It is not committed or applied anywhere, so no rename is needed. Re-check ordering immediately before merge: if another migration lands on the base branch with a later timestamp, rename this directory (only while it is still unapplied everywhere) to sort after it.

## 9. Tests

`tests/unit/core/domain/services/lead-privacy-m158.test.ts`, `…/use-cases/lead-privacy/lead-privacy-use-cases-m158.test.ts`, `…/lead-request/submit-lead-request-contact-sharing-m158.test.ts`, `tests/unit/app/api/cron/lead-privacy-retention-route-m158.test.ts`, `tests/unit/prisma/lead-privacy-boundary-m158.test.ts`, `…/lead-privacy/lead-contact-sharing-purchase-gate-m158.test.ts`, `tests/integration/gdpr/gdpr-lead-privacy-erasure-m158.test.ts`, `tests/integration-db/lead-privacy/lead-privacy-m158.test.ts` (real PostgreSQL).
