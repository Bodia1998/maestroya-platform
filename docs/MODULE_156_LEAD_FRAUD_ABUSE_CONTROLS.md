# Module 156 — Lead Marketplace Fraud & Abuse Controls

Status: implemented on `feature/module-156/lead-marketplace-fraud-abuse-controls`. Ruleset `m156.v1`. **Default mode: `OFF`** (no behavior change, no reads, no writes).

## 1. What this module is — and is not

M156 adds a *risk layer* beside the LEAD_V1 marketplace. It counts reliable and heuristic facts per user, persists signals as append-only evidence, and applies a graduated response: **record → flag for review → temporary block of one specific action → administrator decision**.

It is **not** an authorization mechanism. A risk level, flag or block can only *restrict* publication or purchase initiation (ENFORCE only). It never grants anything, never overrides M138/M139 contact authorization or M155 revocation, and contact access is **observed, never restricted by risk**.

It does not touch refunds, Stripe, ledger/invoices/credit notes, chargeback consequences, affiliate rewards, D12, M152–M155 rules, legal documents, retention (M158) or the roadmap.

## 2. Threats and controls

| Threat | Rule key | Reliability | Window | Default flag / block | Response |
|---|---|---|---|---|---|
| Automated / repeated publication | `PUBLICATION_BURST` | heuristic | 1 h | 10 / 20 | flag, then block `LEAD_PUBLICATION` ≤ 24 h |
| Duplicate / near-duplicate requests (normalised title+description, lower-cased, whitespace-collapsed, LEAD_V1 only) | `DUPLICATE_REQUEST_CONTENT` | heuristic | 24 h | 3 / — | flag only |
| Repeated purchase attempts | `PURCHASE_INITIATION_BURST` | heuristic | 1 h | 15 / 30 | flag, then block `LEAD_PURCHASE_INITIATION` ≤ 24 h |
| Probing purchases of non-purchasable leads (distinct leads) | `PURCHASE_REJECTED_PROBING` | heuristic | 1 h | 10 / — | **record only** (evidence signal; never flags or blocks) |
| Probing contact through unauthorized states (distinct leads) | `CONTACT_ACCESS_DENIED_PROBING` | heuristic | 1 h | 5 / — | flag only |
| Repeated disputes opened / lost, repeated revocations (M155 facts) | `REPEATED_DISPUTES_OPENED`, `REPEATED_DISPUTES_LOST`, `REPEATED_REVOCATIONS` | **reliable** | 90 d | 2 / — | flag only |

Only the first and third rules can block. `PURCHASE_REJECTED_PROBING` is evidence only: it persists a signal for later review but creates no flag and no block, because a rejected purchase is indistinguishable from a stale listing or a double click. Every other rule stops at a flag for administrator review. Stronger restrictions (longer than 24 h, up to 30 d) exist only as an **administrator-imposed** block (`ImposeLeadAbuseBlockUseCase`), which needs an ADMIN/SUPER_ADMIN, an explanation, cannot target the actor, and is audited.

Reliable vs heuristic: dispute/revocation counts (`REPEATED_*`) are derived from persisted M155 rows and are reliable facts. Burst, duplicate-content and probing counts are heuristics derived from request behaviour; the two probing rules count persisted *event signals* (`*_EVENT`, one per subject/lead/hour), the others count live rows. Heuristics (shared offices, double clicks, stale UIs and honest bulk posting can trigger them), which is why they flag first and block only with a short, auto-expiring, specific-action block.

## 3. Modes and rollout

`LEAD_ABUSE_CONTROL_MODE` (exact, case-sensitive; anything else → `OFF` with a logged warning):

- `OFF` (default): the compose factories return the original use case; zero reads/writes.
- `SHADOW`: evaluate and record signals only. Nothing is flagged or blocked.
- `FLAG`: signals + flags for review. No action is restricted.
- `ENFORCE`: also temporary blocks and the per-user rate limit (`LEAD_PUBLISH_BY_USER` 30/h, `LEAD_PURCHASE_INITIATE_BY_USER` 60/h, reusing the Module 24 `AntiAbuseService`). See *ENFORCE failure behaviour* below.

### ENFORCE failure behaviour (fail closed, bounded)

In ENFORCE, before publication or purchase initiation, the guard looks up an established block and evaluates the per-user rate limit. If either call fails with an infrastructure error, it is retried **once** after a short delay (25 ms). If it fails again, the action is refused with the existing localized, retryable `RateLimitedError` (code `RATE_LIMITED`, retry after 5 s); no infrastructure detail is exposed (the cause is logged server-side only). A failed lookup of an existing restriction is never treated as "no restriction". A `RateLimitedError` or `AccountRestrictedError` raised as a business outcome is passed through unchanged and never retried. Trade-off: the message reads as "too many requests" although the cause is availability; a dedicated error type is deliberately not introduced in this pass. Modes: OFF is unchanged (no reads); SHADOW and FLAG never call the restriction lookup or the limiter and so can never refuse because of the risk layer. Contact access is never preflighted: a risk-layer failure cannot grant contact or replace the original denial error. Recording and evaluation *after* an action remain best-effort and never throw.

### Rate-limit store

The limiter is the shared Module 24/44 `AntiAbuseService`. Production **requires** `REDIS_URL` (the environment schema and the repository factory both fail closed); the in-memory limiter exists only for development, tests and genuinely single-instance deployments, where limits are per process. A Redis outage in production therefore surfaces as the bounded-retry-then-refuse behaviour above in ENFORCE, not as a silent bypass.

Thresholds: `LEAD_ABUSE_<RULE>_FLAG_AT`, and `LEAD_ABUSE_<RULE>_BLOCK_AT` for blockable rules. Non-integer, < 1 or `block ≤ flag` overrides are ignored (defaults kept, warning logged).

Suggested rollout: SHADOW for ≥ 2 weeks → review signal volume and false positives → FLAG → review the flagged queue → ENFORCE, optionally with raised thresholds. Rollback: set `OFF`; data remains as audit evidence.

## 4. Persistence

Migration `20261022000000_add_module_156_lead_abuse_controls` (additive) creates `lead_abuse_signals` (append-only, UNIQUE `dedupeKey`, shape CHECKs) and `lead_abuse_decisions` (CHECKs for action/origin/expiry; one ACTIVE flag and one ACTIVE block per subject+action; immutable identity columns; ACTIVE→LIFTED|EXPIRED only; never deleted).

Migration `20261023000000_add_module_156_dispute_facts_view` adds one SELECT-only view, `lead_abuse_professional_dispute_facts`, over the M155 dispute/revocation tables so that M155 keeps sole TypeScript ownership of those tables (its boundary test is unchanged). Rollback: `DROP VIEW "lead_abuse_professional_dispute_facts";`.

Migration `20261024000000_add_module_156_permission_hardening` (additive, idempotent): enables RLS (no policies, not forced; the application connects as the owning role, which bypasses RLS, so behaviour is unchanged) on `lead_abuse_signals` and `lead_abuse_decisions`; `REVOKE ALL … FROM PUBLIC` on both tables and the view; revokes from `anon` / `authenticated` when those roles exist (the Module 33 convention); and, on PostgreSQL >= 15, sets `security_invoker = true` on the view so callers need their own privileges on the M155 tables. On PostgreSQL < 15 the revokes are the only control. Rollback: `ALTER TABLE … DISABLE ROW LEVEL SECURITY; ALTER VIEW … RESET (security_invoker);` (grants are not restored).

Migration `20261025000000_add_module_156_event_signal_cap` (additive): a BEFORE INSERT trigger caps stored **event** signals (`CONTACT_ACCESS_DENIED_EVENT`, `PURCHASE_REJECTED_EVENT`) at **50 per hour and 200 per day per subject and event type** (UTC). It takes a per-subject/type advisory lock so concurrent writers cannot overshoot, and skips the row silently (no exception; `recordSignal` returns `false`), so random nonexistent lead ids cannot create unbounded rows. Dedupe, rule-hit signals (bounded by their dedupe key) and append-only triggers are unchanged. The cap bounds the *growth rate*, not the total: there is **no cleanup or retention here (M158)**. The values are constants inside the migration, mirrored in `LEAD_ABUSE_EVENT_CAP_PER_HOUR/DAY` and checked by a test; changing them needs a new migration. Event-driven rule thresholds above the hourly cap are ignored (unreachable). Rollback: `DROP TRIGGER lead_abuse_signals_event_cap_trg ON lead_abuse_signals; DROP FUNCTION lead_abuse_signals_event_cap();`.

Idempotency: signals and decisions are deduplicated by key / partial unique index; concurrent callers converge on one row and one audit entry. A decision and its audit entry are written in one transaction.

Time-window queries are session-time-zone independent. The columns they compare (`occurredAt`, `createdAt`, `publishedAt`, and the view's `occurredAt`) are `timestamp(3)` holding UTC, while the native Prisma engine binds a JS `Date` in a raw query as `timestamptz`; PostgreSQL would then convert the column using the session time zone, shifting every window by the zone offset on a non-UTC database (a Europe/Madrid session hid the last hour of rows and made every short-window count 0). The five fact queries in `PrismaLeadAbuseFactsReader` therefore pass `since` as an ISO-8601 string and convert it explicitly with `(<iso>::timestamptz AT TIME ZONE 'UTC')`. The event-cap trigger already uses a UTC basis (`now() AT TIME ZONE 'UTC'`). Any new raw time comparison in M156 must follow the same pattern; a static test rejects a bare `${since}`, and the real-database tests run the counts and the daily cap under several `SET LOCAL TIME ZONE` values.

## 5. Interaction with M139 and M155

- Contact authorization (`GetLeadContactUseCase`) is wrapped by an observer that, on `LeadContactAccessDeniedError`, records a probing event and **rethrows the same error**. Storage failure in the observer is swallowed; the denial stands (fail closed for contact).
- DISPUTED and REVOKED purchases remain denied; WON restores exactly as M155 defines; a risk flag or block neither restores nor withdraws contact.
- LEAD_V1/legacy isolation: facts are LEAD_V1 only; legacy flows are not wrapped.
- Professional verification is not bypassed or replaced.

## 6. Operations

- Open flags: `ListOpenLeadAbuseFlagsUseCase`. Lift a decision: `LiftLeadAbuseDecisionUseCase` (mandatory note; an administrator cannot lift a decision about their own account). There is **no admin UI/API caller yet** (M157).
- Expired blocks stop restricting at read time and are swept lazily when the next block is created; no scheduler is required.
- Block rejections use the existing localized `AccountRestrictedError`.

## 7. Known limitations

- Heuristics can false-positive (shared networks, bulk posting, double submissions, stale UI). Hence flag-first, specific-action, ≤ 24 h automated blocks.
- Rejected purchases/contact are generic: a deliberate bypass attempt cannot be told apart from a stale UI; these only flag.
- In-flight requests may complete just after a block is created.
- Rate-limit keys are per user; the in-memory limiter is per instance unless a shared store is configured. No device fingerprinting or IP tracking was added.
- In ENFORCE the risk layer fails **closed** (bounded retry, then a generic retryable refusal) for publication and purchase initiation; in OFF/SHADOW/FLAG it cannot refuse. Contact authorization and post-action recording are never affected.
- Counters read live tables with indexes only on pre-existing columns; very large tenants may need index review.
- GDPR/retention (M158) is not handled: the signals table is append-only and its FK to `users` is RESTRICT.
- Prisma does not model the fact view; `prisma migrate dev` drift tooling may report it as unmanaged (same as the existing triggers/functions).

## 8. Owner decisions and deployment notes

- Production PostgreSQL version is not stated in the repository; `security_invoker` needs >= 15 (CI/docker use 16).
- Older tables (including the M155 `lead_*` tables) have no RLS and no revokes from `anon` / `authenticated`; M156 does not touch them. Whether the database is reachable through a PostgREST/Supabase data API cannot be verified from the repo and should be decided by the owner. No `ALTER DEFAULT PRIVILEGES` was added.
- Do not leave `ENFORCE` on without a healthy shared limiter (`REDIS_URL`).
- Enforcement stays `OFF` by default; `.env.example` lists the supported `LEAD_ABUSE_*` variables.
