# Module 13 — Reviews & Ratings

Repository: `maestroya-platform-auth` · Branch: `feature/reviews-ratings`

---

## 1. What this module implements

A customer can leave exactly one review (1–5 star rating + optional
written comment) for a **completed Job**. Reviews are readable by the two
Job participants (customer, professional) and — once published — publicly
listable per professional, alongside an aggregate rating (average +
count) computed from real review data.

In scope:

- `CreateReviewUseCase` — the only write path.
- `GetReviewByJobUseCase` — the review for one Job, if any.
- `ListProfessionalReviewsUseCase` — public listing for a professional.
- `GetProfessionalRatingSummaryUseCase` — public average + count.
- `POST`-style Server Action `createReviewAction`.
- Prisma schema changes anchoring `Review` to `Job` (see Section 4).

Out of scope (see Section 6 — Deferred):

- Editing or deleting a review.
- Replying to a review (the `response`/`respondedAt` columns already exist
  on the schema but are unused by this module).
- Moderation (flag/remove/approve) — Module 16, Admin Panel.
- Any Payment/Stripe dependency — Module 12 is deferred and untouched.
- Company-side reviewees, review UI/pages.

## 2. Eligibility rule

**A review can only be created for a Job whose `status` is `COMPLETED`.**

This is the sole authoritative prerequisite. It is derived by loading the
Job fresh from `JobRepository.findById` inside `CreateReviewUseCase` —
never inferred from `ServiceRequest.status`, `Quote.status`,
`Appointment.status`, or any client-supplied flag. In particular, there is
**no** `Payment.status` check: Module 12 (Payment/Stripe Connect) is
intentionally deferred, and this module works fully independently of it.

Rejected: `CREATED`, `IN_PROGRESS`, `CANCELLED`, and any future non-
`COMPLETED` status.

## 3. Authorization model

Reuses the exact primitives every other Job-lifecycle use case uses —
`requireAuth()` at the Server Action boundary, then `resolveJobActor`
inside the use case:

- The authenticated `userId` (never a client-supplied `customerId`) is
  resolved against the Job's own `customerId`/`professionalProfileId` via
  `resolveJobActor`.
- Only the resolved `"customer"` role may create a review for the Job.
  A professional cannot create a customer review by calling with their
  own `userId` — `resolveJobActor` would resolve them to `"professional"`
  (or, if they have no relationship to the Job at all, throw the same
  `NotFoundError` an unrelated user gets).
- An unrelated user (customer or professional) gets the identical
  `NotFoundError` a nonexistent `jobId` would produce — no distinguishable
  "forbidden" response exists anywhere in this module, so a Job's
  existence/ownership can never be probed.
- The reviewee (`revieweeProfessionalProfileId`) is always read off the
  Job record (`job.professionalProfileId`) — there is no
  `professionalId` field anywhere in `CreateReviewInput`, so a client
  cannot redirect a review to an arbitrary professional even in principle.
- Reads (`GetReviewByJobUseCase`) use the same `resolveJobActor` check —
  only the Job's own customer or professional may fetch "the review for
  this Job."
- Public reads (`ListProfessionalReviewsUseCase`,
  `GetProfessionalRatingSummaryUseCase`) require no authentication at all,
  mirroring Professional Discovery's own public profile endpoint — a
  professional's rating and published reviews are public marketing data,
  the same as their profile.

## 4. One review per Job

Enforced at both levels required by the spec:

1. **Application level** — `CreateReviewUseCase` calls
   `ReviewRepository.findByJobId` before writing and throws
   `ConflictError` if a review already exists.
2. **Database level** — `Review.jobId` is `@unique` (see
   `prisma/migrations/20260725000000_add_review_job_anchor`). A
   concurrent second write that races past the application-level check is
   rejected by the unique index; `PrismaReviewRepository.create` catches
   the resulting Prisma `P2002` error and translates it into the same
   `ConflictError` — no raw Prisma error ever escapes the repository.

Since a Job has exactly one `customerId`, "at most one review per Job" and
"at most one *customer* review per Job" are the same constraint — a
composite key was not needed.

## 5. Rating scale & comment

- Rating: integer, 1–5 inclusive (`domain/services/review-rules.ts`'s
  `isValidRating`), enforced at three layers: the Server Action's Zod
  schema (`createReviewSchema`), the use case (defense in depth, since
  every use case in this codebase is also called directly by tests/other
  callers), and a DB `CHECK` constraint already present on `Review.rating`
  since the model's original migration.
- Comment: optional, trimmed; a whitespace-only or empty comment is
  normalized to `null` (`normalizeComment`). Capped at 2000 characters at
  the DTO boundary — no existing project-wide comment-length convention to
  match, so this follows `MAX_QUOTE_NOTES_LENGTH`'s "generous but bounded"
  precedent (3000 chars) scaled down slightly for a review comment's
  expected length.

## 6. Schema changes (audit result)

A `Review` model already existed (schema-only — zero application code
referenced it anywhere before this module), anchored to `ServiceRequest`
with a `status` moderation enum (`PENDING/PUBLISHED/FLAGGED/REMOVED`), a
professional/company XOR reviewee, and unused `response`/`respondedAt`
fields for a future public-reply feature.

Two minimal, additive changes were made rather than a redesign:

1. **Added `Review.jobId`** (`UUID`, `@unique`, FK to `Job`, `onDelete:
   Restrict`) — Job, not ServiceRequest, is the authoritative source for
   "was the work completed" (see Module 11's own audit report, Finding 1).
   `serviceRequestId` was kept, not removed — Appointment already
   establishes the precedent of keeping `quoteId`/`serviceRequestId`
   denormalized alongside the newer, authoritative `jobId`, so this is
   consistent with an existing pattern rather than new duplication.
2. **Changed `Review.status`'s default from `PENDING` to `PUBLISHED`** —
   Module 13 does not implement a moderation/approval workflow (Module
   16's job); with the old default, every review this module ever creates
   would stay permanently invisible, since nothing in this module
   transitions a review to `PUBLISHED`. The enum itself is untouched, so
   Module 16 can later add moderation (flag/remove, or even reinstate a
   pending-approval step) without another schema change.

Nothing else on `Review` changed. `rating`'s 1–5 `CHECK` constraint and the
professional/company XOR `CHECK` constraint both already existed and
needed no changes.

Migration: `20260725000000_add_review_job_anchor` (hand-authored — no
live Postgres/Prisma-engine access in the development sandbox used for
this module, same documented caveat every prior migration in this repo
carries; run `npx prisma migrate dev` against a real database to confirm
before deploying).

## 7. Professional rating aggregation

`ReviewRepository.getProfessionalRatingSummary` computes `averageRating`
(rounded to 1 decimal place) and `reviewCount` from actual `PUBLISHED`
reviews at read time, via `prisma.review.aggregate` — there is no
denormalized average stored on `ProfessionalProfile`. This keeps the
number always correct (no drift/backfill risk) and matches this module's
MVP scope; if read-time aggregation ever becomes a performance concern at
scale, a materialized/cached value can be introduced later without
changing `GetProfessionalRatingSummaryUseCase`'s contract.

This is the seam Module 19 — Search & Ranking is expected to consume later
(read `ReviewRepository`/`GetProfessionalRatingSummaryUseCase` when
ranking search results). Module 13 has no knowledge of, or dependency on,
Module 19 in the other direction.

## 8. Immutability & deletion

No edit or delete use case exists. No product requirement calls for
either, and the existing schema's `response`/`status` fields already leave
room for a future reply/moderation feature without needing a Review
versioning scheme now. Deletion/moderation is explicitly Module 16 — Admin
Panel's responsibility; Module 13 does not build any part of it.

## 9. Notifications — decision

No `ReviewNotifier` port/adapter was added. `ChatJobNotifier`/
`ChatAppointmentNotifier` post a system message into the Job's/
Appointment's own conversation about *that resource's* lifecycle; a
review, by contrast, has no natural home in a Job-scoped conversation once
the Job is already complete, and posting "the customer left a review" to
the professional would be better modeled as a genuine notification (email/
in-app) — Module 15's actual job. Building a narrow one-off `ReviewNotifier`
now, only to have Module 15 replace or duplicate it, would be scope creep
this module's instructions explicitly warn against. Deferred to Module 15.

## 10. Deferred / explicitly out of scope

- Payment/Stripe Connect dependency (Module 12) — none introduced;
  reviews work purely off `Job.status`.
- Review editing, deletion, and professional replies.
- Moderation workflow (flag/remove/approve) — Module 16.
- Notifications on review creation — Module 15 (see Section 9).
- Company-side reviewees — the schema already supports it
  (`revieweeCompanyProfileId`), but no use case populates it yet, matching
  the rest of this codebase's "solo professionals only, end to end" scope.
- UI/pages — this module ships the Server Action and use cases; no page
  was added or changed.
- Denormalized/cached average rating on `ProfessionalProfile` — read-time
  aggregation only (see Section 7).

## 11. Architectural risks / follow-ups for future modules

- `npx prisma generate`/`npx prisma migrate dev` could not be run in the
  sandbox this module was developed in (no network access to Prisma's
  binary CDN, and no live Postgres instance) — run both against a real
  environment before merging, and diff the hand-authored migration SQL in
  Section 6 against what `prisma migrate dev` would generate.
- `CreateReviewUseCase` already copies both `job.professionalProfileId`
  and `job.companyProfileId` onto the created Review (whichever one the
  Job actually has set), so the reviewee side of a future company-owned
  Job's review would populate correctly against the DB's XOR `CHECK`
  constraint. The real limitation is upstream, in `resolveJobActor`
  (reused as-is from Module 11): it only resolves the *customer* side of a
  company-owned Job today — the company side has no `CompanyMember`-aware
  resolution yet (this is `resolveJobActor`'s own pre-existing, documented
  limitation, not something introduced by this module). A company
  employee therefore cannot yet be authorized as the Job's "professional"
  for anything, reviews included; this is expected to be revisited
  together with Module 18, not by this module.
