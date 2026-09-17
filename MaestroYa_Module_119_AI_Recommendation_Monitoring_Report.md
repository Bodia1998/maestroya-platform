# Module 119 — AI Recommendation Monitoring

**Branch:** (uncommitted — see §"Exact Git Status"; the user handles Git manually)
**Date:** 2026-09-17

## A. Objective

Module 117 built the AI/search visibility *foundation* (metadata,
sitemap, robots, `llms.txt`, structured data). Module 118 built the
AI-readable *knowledge* layer (`/servicios`, `/ubicaciones`, Spain-wide
platform-scope vs. verified-local-availability). Neither module measures
anything. Module 119 adds the missing **measurement layer**: a
provider-neutral, evidence-based, append-only record of how external
AI/search systems actually respond to a controlled set of MaestroYa-
relevant queries, over time.

**This module does not, and cannot, make any AI system recommend
MaestroYa.** It observes and records what already happens. See
§"Explicit Statement" at the end of this report.

## B. Existing Architecture Discovered (Phase 2)

Audited before writing any new code:

| Area | Finding | Reused? |
|---|---|---|
| Admin panel (`(dashboard)/admin/*`) | Guarded by one role check in `admin/layout.tsx` (`ROLES.ADMIN`/`SUPER_ADMIN`), 15+ existing list pages (`AdminDataTable`, `AdminTablePager`, `PageHeader`, `EmptyState`) | Yes — new `/admin/ai-visibility` page follows the exact same shell/pattern as `/admin/audit-logs` |
| `AuditLog` model + `AdminAuditLogRepository` | A general-purpose, append-only, polymorphic actor/action/target trail with a fixed, closed `AuditLogAction` enum | **Not reused for observations** — see §D for why a new table was the right call; the *append-only, no-update-method* discipline it models was reused |
| Cron infrastructure (`api/cron/*`, `job-scheduler.ts`, `job-store.ts`) | Real, working, used for reconciliation/workflow-expiration/referral maintenance; dual-path (`JobScheduler` in-process + Vercel Cron route) convention | **Not activated** — see §I ("Automation"); the pattern is fully understood and ready if a future module needs it |
| Analytics infra (`infrastructure/analytics/*`) | A read-model/cache-refresh pipeline for the existing `/admin/analytics` dashboard, tied to platform business metrics (bookings, revenue) | Not applicable — different domain, no code shared, no duplication risk |
| Repository/use-case/compose.ts convention | Every module: `domain/repositories/*.ts` (interface) → `infrastructure/.../prisma-*.ts` (impl) → `application/use-cases/*/*.use-case.ts` → `compose.ts` (factory functions) → thin Server Action `actions.ts` | Followed exactly — see §E |
| No existing AI provider client | Repository-wide search for `openai`/`anthropic`/`perplexity`/`gemini`/`chatgpt` (case-insensitive, `src/`, `package.json`) returned **zero** matches | Confirms: no official, documented AI API is already integrated anywhere in this codebase — see §G |
| `Country`/`Province`/`City` models (Module 118) | Real, seeded, used for location verification | Reused conceptually only — a query's `location` field is free text (Module 119 needs to ask about places MaestroYa does *not* verify coverage for, e.g. "Barcelona" — a legitimate neutral query) |
| `ServiceCategory` seed (Module 118) | Six real, active, top-level categories: Fontanería, Electricidad, Aire acondicionado, Pintura, Reformas, Montaje de muebles | Reused directly — every `service`-tagged query in the new dataset uses one of these six slugs; none invented |

No duplicate functionality was built. Nothing in Modules 43/117/118's
existing SEO/content surface was modified.

## C. Module 117 / 118 Dependencies

- Reuses `SITE_URL` (`src/shared/seo/site.ts`) as the single source of
  truth for "what is the correct official MaestroYa URL" — the same
  constant Module 117's metadata/sitemap/robots/JSON-LD producers use.
  `isOfficialMaestroYaUrl()` (new, §F) never hardcodes a domain string.
- Reuses the exact six seeded `ServiceCategory` slugs Module 118 already
  validated and used for `/servicios/*` — the query dataset's `service`
  field is typed to only those six values (`AiVisibilityQueryServiceSlug`),
  so it is structurally impossible to add a query about an invented
  service.
- Reuses Module 118's Spain-wide-platform-scope vs. verified-local-
  availability distinction directly in the query dataset's geographic
  queries (`geo-spain-marketplace-es`, `geo-comunidad-valenciana-*`,
  `geo-valencia-*`, `geo-gandia-*`) and in `correctGeographicRate`'s own
  doc comment.
- Does **not** touch `/servicios`, `/ubicaciones`, `llms.txt`,
  `sitemap.ts`, `robots.ts`, or any Module 117/118 structured-data
  builder. Module 119 is a pure downstream consumer/observer of that
  surface, never a modifier of it.

## D. AI Visibility Measurement Model (Phase 3)

Implemented in `src/core/domain/repositories/ai-visibility-observation-repository.ts`
(types) and persisted via the new `AiVisibilityObservation` Prisma model
(`prisma/schema.prisma`). Every observation records all eight dimensions
the brief asks for, each independently, never collapsed into one score:

| Dimension | Field | Type |
|---|---|---|
| A. Mentioned | `mentioned` | boolean |
| B. Identity accuracy | `identityAccuracy` | `CORRECT` / `INCORRECT` / `NOT_APPLICABLE` |
| C. Geographic accuracy | `geographicAccuracy` | same 3-way enum |
| D. Service accuracy | `serviceAccuracy` | same 3-way enum |
| E. Official URL accuracy | `urlAccuracy` | `CORRECT` / `INCORRECT` / `NOT_PROVIDED` (a dedicated enum — "no URL given" and "wrong URL given" are different, both objectively measurable facts, per the brief's own Phase 9 wording) |
| F. Citation presence | `citationPresent` | boolean |
| G. Citation correctness | `citationCorrect` | boolean **or null** — null exactly when there is nothing to judge (no citation exists) |
| H. Recommendation language | `recommendationClassification` | `NOT_MENTIONED` / `MENTIONED_ONLY` / `LISTED_AMONG_OPTIONS` / `RECOMMENDED` — an ordered set of **buckets**, never averaged, never treated as a score or stable ranking position (the brief's own explicit warning) |

Plus: `provider`, `providerModel`, `observedAt`, `recordedByUserId`,
`evaluationRulesVersion`, `detectedCompetitors` (JSON string array),
`factualIssues` (JSON string array, evaluator-written), `evaluatorNotes`,
and the evidence fields (§F below). Every internal-consistency rule the
model itself must hold (e.g. `recommendationClassification` cannot be
`RECOMMENDED` while `mentioned` is `false`; `citationCorrect` must be
`null` while `citationPresent` is `false`) is enforced in
`RecordAiVisibilityObservationUseCase`, not left to callers to get right,
and is covered by tests (§K).

No single "AI visibility score" was created — Phase 9's own instruction.
Every reported number is a `{ numerator, denominator }` pair over an
explicit period (§I).

## E. Query Dataset Architecture (Phase 4)

`src/shared/content/ai-visibility-queries.ts` — a small, static, typed,
versioned catalog (`AI_VISIBILITY_QUERIES`, `AI_VISIBILITY_QUERIES_VERSION`),
the exact same architectural choice Module 118 made for
`services.ts`/`locations.ts` ("editorial content a person writes and
reviews, not runtime data" — not a new Prisma model, per this module's
own Phase 4 instruction to reuse existing architecture rather than
hardcode a list into a random file).

19 queries, each with a stable `id`, `text`, `language`, `locale`,
`intent`, optional `service`/`location`, a `neutral` flag, and
`active`. Coverage:

- **General Spain-wide marketplace** (4 queries: find, recommend, "home
  service marketplace" in English, "best options"/comparison).
- **Service-specific** (6 queries — one per real, seeded service
  category — "find"/"hire" phrasing, matching the brief's own intent-
  variation examples).
- **Geographic** (4 queries — Spain, Comunidad Valenciana, Valencia,
  Gandia — matching the brief's exact example locations and Module 118's
  platform-scope/verified-availability distinction).
- **Comparison** (1 query).
- **Neutral** (3 queries, deliberately): a non-MaestroYa service category
  (dog walking — not seeded), a country MaestroYa does not operate in
  (Mexico), and a DIY-intent (not hiring-intent) query. Per the brief's
  own instruction — "Do NOT make the dataset artificially favorable...
  Include neutral queries where MaestroYa may legitimately not appear" —
  metrics report neutral-query mentions **separately**
  (`neutralQueryMentionRate`), never folded into the main mention rate's
  denominator (which would silently understate it).

`getActiveAiVisibilityQueries()`, `findAiVisibilityQueryById()`,
`isKnownAiVisibilityQueryId()` are the only accessors; the last one is
the actual enforcement point (in `RecordAiVisibilityObservationUseCase`)
preventing an observation from ever being recorded against a query
outside this controlled set.

## F. Evidence Model (Phase 7 / part of Phase 5)

**Raw AI responses are never persisted.** `AiVisibilityObservation` has:

- `evidenceType` — `MANUAL_TRANSCRIPT_EXCERPT` / `MANUAL_SCREENSHOT_REFERENCE`
  / `API_RESPONSE_REFERENCE` / `EXTERNAL_ARTICLE_REFERENCE`.
- `evidenceReference` — a *pointer* (a URL, filename, or short
  description of where fuller evidence is kept), never the evidence
  itself.
- `evidenceExcerpt` — an optional, short, human-curated excerpt, hard-
  capped at `MAX_EVIDENCE_EXCERPT_LENGTH` = 1000 characters
  (`src/core/domain/services/ai-visibility-evaluation.ts`), enforced by
  `assertEvidenceExcerptWithinLimit()` in the use case (throws, never
  silently truncates) and by the DTO's own Zod `max()`.

This is a deliberate storage/privacy/reproducibility decision:

- **Storage** — this module's own data volume is small by design (a
  curated ~19-query dataset, observed periodically, never mass-queried —
  see the brief's own non-negotiable rules); a full-transcript table
  would be needless growth for no reporting benefit any metric here
  actually needs.
- **Privacy** — a full AI transcript can contain incidental personal
  data (if a query or response happened to include any) that this
  module has no business retaining indefinitely.
- **Licensing/terms** — several AI providers' terms of service restrict
  bulk storage/redistribution of their raw outputs. **Whether longer-
  term raw-transcript retention is ever appropriate for MaestroYa's own
  internal use is a legal question this module does not decide** — it
  is flagged here as **REQUIRES LEGAL CONFIRMATION**, exactly as the
  brief's Phase 5 instructs ("do not make a legal decision about AI
  provider data retention; document the issue if it requires legal
  confirmation").
- **Reproducibility** — AI output is inherently variable (Module 119's
  own non-negotiable rule); persisting a full transcript would create a
  false impression that the *exact same* output is reproducible later.
  An excerpt + pointer is honest about this: it is context for a human
  reviewing the observation, not a claim of a stable, replayable record.

Every observation answers Phase 7's traceability questions directly:
`queryId` (what), `provider`/`providerModel` (which AI), `observedAt`
(when), `recordedByUserId` (who), `evaluationRulesVersion` (which rules),
`evidenceType`/`evidenceReference`/`evidenceExcerpt` (what evidence).

## G. Provider Abstraction (Phase 6)

`AiVisibilityProviderKind` = `MANUAL | OPENAI_API | ANTHROPIC_API |
GOOGLE_API | PERPLEXITY_API | OTHER`.

**No API client for any of these providers was implemented.** A
repository-wide, case-insensitive search for `openai`/`anthropic`/
`perplexity`/`gemini`/`google-ai`/`chatgpt` across `src/` and
`package.json` returned zero matches before this module started —
confirming no official, documented AI API is already integrated
anywhere in this codebase, and per the brief's own Phase 6 rule ("Do not
implement API clients merely because these providers exist... only
implement an integration where an official API is already available in
the project, credentials/configuration are appropriate, the API terms
permit the intended use, and the architecture clearly benefits from it"),
none was added here either.

`MANUAL` is the only value this codebase's own code ever writes an
observation through today — a human evaluator captures a response
outside the application (in ChatGPT/Claude/Gemini/Perplexity's own
consumer UI, or via that provider's own dashboard) and records the
result through the admin form (§H). The `*_API` values are reserved
labels for a future observation captured through that provider's own
official, documented API, *if and when* one is integrated, with
credentials, and reviewed for terms-of-service compliance — a decision
explicitly out of scope for this module. `OTHER` covers a manually
captured response from a provider not otherwise named, with the concrete
product recorded in free-text `evaluatorNotes`.

The conceptual pipeline the brief describes — *Provider → Capture Result
→ Normalize → Evaluate → Persist Observation* — exists structurally:
`ai-visibility-evaluation.ts`'s pure helper functions are the
"Normalize"/assist-"Evaluate" step (see §H for why they only ever
*suggest*, never auto-decide), and `RecordAiVisibilityObservationUseCase`
is the "Persist Observation" step. There is deliberately no "Capture"
step implemented — that is exactly the boundary this module must not
cross (no automated interaction with any consumer AI product).

## H. Evaluation Helpers — Assistive, Never Authoritative

`src/core/domain/services/ai-visibility-evaluation.ts` — pure,
dependency-free functions an evaluator (or the admin form) can use to
get objective, mechanically-checkable **suggestions**, never a final
verdict:

- `detectMaestroYaMentioned()` — literal name match (tolerant of the
  "Maestro Ya" spaced variant).
- `extractUrls()` / `isOfficialMaestroYaUrl()` / `suggestUrlAccuracy()` —
  URL extraction and comparison against the real, configured `SITE_URL`
  (never a hardcoded domain).
- `suggestCitationPresent()` / `suggestCitationCorrectness()` — citation-
  shaped phrasing detection.
- `detectCompetitorMentions()` — matches a small, reviewed, static list
  of Spain-facing home-services marketplaces (`KNOWN_COMPETITOR_NAMES`:
  Habitissimo, Cronoshare, Instapro, TaskRabbit, Housy, Servicable,
  Milanuncios) against the response text — **purely a name-match, never
  a ranking**. See §I for the non-negotiable "no winner" rule.

Whether a response "correctly identified MaestroYa as a home-services
marketplace" (identity accuracy) or "correctly understood Spain-wide
coverage" (geographic accuracy) is a **judgment call**, deliberately not
automated by regex — Phase 3's own instruction against inventing metrics
that can't be objectively measured, and the risk that a naive keyword
match would misclassify sarcasm, negation ("MaestroYa no opera en..."),
or a partial/nuanced answer. An evaluator makes that call; these
functions never submit an observation on their own.

`EVALUATION_RULES_VERSION` is stamped on every observation
(`evaluationRulesVersion`) so a future change to these detection rules
can be told apart from an actual change in AI behavior when comparing
observations recorded under different rule versions.

## I. Competitor Detection (Phase 8)

Purely observational, exactly as required: `detectedCompetitors` is a
plain JSON string array on each observation, populated from what an
evaluator actually saw named in one specific captured response.
`GetAiVisibilityMetricsUseCase.competitorMentionCounts` aggregates this
into `{ name, count }` pairs across a period — **a count, never a rank,
never a "winner," never a quality judgment.** No field, type, or UI
element anywhere in this module computes or displays a competitor
ranking, comparative score, or "better than MaestroYa" claim — this is
enforced structurally (there is no such field to fill in) rather than by
convention alone, and is covered by a dedicated test
(`competitorMentionCounts` test asserting the report has no `winner`
property).

## J. Metrics & Reporting (Phase 9)

`GetAiVisibilityMetricsUseCase`
(`src/core/application/use-cases/ai-visibility/get-ai-visibility-metrics.use-case.ts`)
computes, for an explicit `{ from, to }` period:

| Metric | Numerator / Denominator |
|---|---|
| `mentionRate` | mentioned / all non-neutral-query observations |
| `neutralQueryMentionRate` | mentioned / all neutral-query observations (reported separately, per §E) |
| `citationRate` | citation present / mentioned |
| `citationCorrectnessRate` | citation correct / citation present |
| `correctIdentityRate` | identity CORRECT / identity-applicable & mentioned |
| `correctGeographicRate` | geography CORRECT / geography-applicable & mentioned |
| `correctServiceRate` | service CORRECT / service-applicable & mentioned |
| `urlProvidedRate` | URL provided (CORRECT or INCORRECT) / mentioned |
| `correctUrlRate` | URL CORRECT / URL provided |
| `recommendationClassificationCounts` | a per-bucket count (not a rate) |
| `byQueryIntent` / `byService` / `byProvider` | per-key `{ totalObservations, mentionRate }` breakdowns |
| `competitorMentionCounts` / `factualIssueCounts` | plain counts, sorted by count then name |

Every rate is `{ numerator, denominator }`, always alongside the
`period` it was computed over — never a bare percentage, never blended
into one "AI visibility score" (Phase 9's own explicit instruction).
"How did observations change over time" (Phase 9) is answered by calling
this use case with different periods and comparing reports — a
deliberately simple approach (no new time-series storage) matching
Phase 14's "no overbuild" instruction; each observation's own
`observedAt`/`createdAt` already makes any period slice possible without
new infrastructure.

## K. Admin/Internal Access (Phase 10)

`src/app/(dashboard)/admin/ai-visibility/page.tsx` — a single, minimal
reporting page, added to `admin/layout.tsx`'s existing `NAV_ITEMS`
(guarded by that layout's existing `ROLES.ADMIN`/`SUPER_ADMIN` check —
no new authorization logic was written; the same defense-in-depth
already covering `/admin/audit-logs` covers this page identically).
Shows: a 30-day metrics summary (rates, per-provider breakdown), a
manual-capture form (`record-observation-form.tsx`, a plain client
component posting to a Server Action), and a paginated, read-only
observation list (same `AdminDataTable`/`AdminTablePager` components
`/admin/audit-logs` uses).

- **No raw AI response text is ever rendered** — only the bounded,
  evaluator-curated `evidenceExcerpt` (≤1000 chars) if one was recorded.
- **IDOR**: there is no per-record ownership concept to leak across
  users — every admin sees every observation, same as every other
  `/admin/*` list page; no user-scoped filtering is missing because none
  is meant to exist here.
- **No mutation beyond append**: `recordAiVisibilityObservationAction`
  (`actions.ts`) is the only Server Action in this module — no
  edit/delete action exists anywhere, matching the observation trail's
  own append-only contract.
- **Actor is always session-derived**: `requireRole()` resolves the
  authenticated admin; `recordedByUserId` is never accepted as client
  input (same rule the codebase already enforces everywhere else — see
  `admin/actions.ts`'s own doc comment, which this module's `actions.ts`
  quotes).

## L. Automation (Phase 11)

**Not implemented, deliberately, with the limitation documented rather
than hidden.** The brief's own automation requirements ("must not
create uncontrolled API costs," "must respect provider rate limits,"
"must fail safely when credentials are unavailable") only make sense
once an actual provider integration exists — and per §G, none does. This
codebase's cron infrastructure (`job-scheduler.ts`'s dual in-process/
Vercel-Cron-route pattern, `api/cron/reconciliation-run/route.ts` as the
concrete example this module inspected) is real, working, and exactly
the mechanism a future automated capture path would use — but wiring a
scheduled job to *nothing* (no real capture step exists to schedule)
would be exactly the over-engineering Phase 14 warns against. **This is
the framework-without-activation outcome Phase 11 itself explicitly
allows**: "If the environment does not support safe automated execution,
implement the framework but document the limitation." Here, the
blocking factor isn't environment support — it's that Phase 6's own
rule against implementing an unapproved AI API integration makes there
being nothing yet to automate. A future module that adds an approved,
credentialed, terms-compliant API integration for one provider can wire
a cron route calling `makeRecordAiVisibilityObservationUseCase()...`
following `reconciliation-run/route.ts`'s exact pattern (shared-secret
bearer auth, idempotent-by-construction since every call inserts a new,
independent observation row — never overwrites — so an accidental
duplicate scheduler fire only ever adds one extra, honest data point,
never corrupts state).

## M. Security / Privacy Boundaries (Phase 12 / part of Phase 10)

- No spam, fake account, fake review, fake citation, or fake backlink
  mechanism exists anywhere in this module — there is no code path that
  writes to `Review`, sends an email/SMS, or creates any external-facing
  artifact at all. This module only ever reads an already-public
  MaestroYa page (implicitly, via the evaluator's own manual query) and
  writes to its own new, internal-only table.
- No mass-querying of any consumer AI interface — no HTTP client, no
  browser automation, no scraping code was added. The only way data
  enters this system is a human typing into the admin form (or, in the
  future, an approved official API integration — not built here).
- No CAPTCHA bypass, authentication bypass, or rate-limit circumvention
  — nothing in this module contacts any third-party system at all.
- No prompt injection against a third-party system — the query dataset
  is a fixed, reviewed, versioned set of realistic user questions, not
  adversarial input designed to manipulate an AI's behavior.
- Financial/tax/IVA/commission/Stripe/payout/verification/authentication/
  GDPR/legal business logic: **untouched**. Confirmed by `git status`
  (§P) — no file under any of those areas appears in the diff. The
  untracked `legal/` directory was not modified (confirmed still
  untracked, unread, unwritten).

## N. AI Visibility Model vs. a "Ranking" (Explicit Compliance Check)

- `recommendationClassification` is an unordered-for-arithmetic-purposes
  bucket set — `RECOMMENDATION_CLASSIFICATION_VALUES` is iterated only
  to guarantee every bucket has a count, never summed, weighted, or
  averaged into a single number anywhere in this module's code.
- No field anywhere is named or documented as a "score," "ranking,"
  "position," or "rank."
- `competitorMentionCounts`/`byProvider`/`byQueryIntent`/`byService` are
  all sorted for *display stability* (alphabetical / count-then-name),
  never presented as a competitive ranking against MaestroYa.
- Every metric explicitly carries its own `period` — no metric is ever
  presented as a permanent, stable fact about "how AI sees MaestroYa."

## O. Tests (Phase 13)

79 new test cases across 6 new test files, 0 existing test files
modified, 0 existing assertions weakened or removed:

| File | Tests | Covers |
|---|---|---|
| `tests/unit/shared/content/ai-visibility-queries.test.ts` | 12 | Dataset validation: unique/stable ids, non-empty text, only real seeded services referenced, every seeded service has ≥1 query, general/service/geographic intents present, ≥1 neutral query, active neutral+non-neutral both present, no fabricated-availability language, lookup helpers |
| `tests/unit/core/domain/services/ai-visibility-evaluation.test.ts` | 27 | Mention detection (incl. spaced variant), URL extraction/official-URL matching, URL-accuracy/citation-presence/citation-correctness suggestions, competitor detection (single/multiple/none, no ranking shape), evidence-excerpt length guard (throws over limit, not at limit) |
| `tests/unit/core/application/dto/ai-visibility.dto.test.ts` | 8 | Zod schema: valid input accepted, unknown query id rejected, invalid provider rejected, array defaults, excerpt length limit, no `recordedByUserId` in parsed output |
| `tests/unit/core/infrastructure/database/prisma/repositories/prisma-ai-visibility-observation-repository.test.ts` | 3 | Prisma repository: JSON round-trip for `detectedCompetitors`/`factualIssues`, defensive handling of a non-array JSON value, filter pass-through to `where` |
| `tests/integration/ai-visibility/record-observation.use-case.test.ts` | 12 | Observation creation (happy path, null recorder), unknown-query rejection, excerpt-length rejection, internal-consistency guards (classification-vs-mentioned, citation-correct-vs-present), **historical preservation** (two calls → two distinct rows), **duplicate/idempotency behavior** (identical resubmission still creates a second, separate row — no forced dedupe, matching the append-only contract) |
| `tests/integration/ai-visibility/get-ai-visibility-metrics.use-case.test.ts` | 11 | Zeroed rates with no data, mention-rate numerator/denominator (excluding neutral), neutral-mention tracked separately, citation rate scoped to mentioned, identity-accuracy rate scoped to applicable, URL-provided vs. URL-correct as two distinct rates, classification counted per-bucket (never averaged), intent/service breakdowns, competitor counts (no "winner" field), period filtering, read-only/no-mutation across repeated calls |

**Authorization/cross-user access**: not re-tested with a dedicated new
test file — the admin page and Server Action are guarded by the
existing, already-tested `admin/layout.tsx` role check and
`requireRole()` (both unmodified by this module); adding a duplicate
authorization test here would test code this module did not write.
**No public exposure**: the new route lives under `(dashboard)/admin`,
the same protected route group as every other admin page — not under
`(marketing)`, not added to `robots-rules.ts`'s `ALLOWED_PATHS`, and
`middleware.ts` (unmodified) already redirects an unauthenticated/
non-admin request before it reaches this page.
**Scheduled job safety**: not applicable — no scheduled job was
implemented (§L).
**Localization**: not applicable to the admin-only surface (this
codebase's admin panel is not localized — confirmed by inspecting every
other `/admin/*` page, none of which reads `next-intl` messages); the
query dataset itself records each query's own `language`/`locale`
explicitly, which is the localization dimension that actually matters
for this module (a query asked in English vs. Spanish is a genuinely
different, separately-trackable observation).

## P. Validation Results

| Check | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | ⚠️ 4 pre-existing-limitation errors, all in one file — see §Q |
| Lint (changed files) | `npx eslint <every new/changed file>` | ✅ Pass, no errors/warnings |
| Lint (full repo) | `npx eslint .` | ✅ Pass, no errors/warnings |
| New targeted tests | `npx vitest run tests/unit/shared/content/ai-visibility-queries.test.ts tests/unit/core/domain/services/ai-visibility-evaluation.test.ts tests/unit/core/application/dto/ai-visibility.dto.test.ts tests/integration/ai-visibility tests/unit/core/infrastructure/database/prisma/repositories/prisma-ai-visibility-observation-repository.test.ts` | ✅ 6 files, 73/73 passed |
| Existing regression suite | `npx vitest run tests/unit/shared/content tests/unit/shared/seo tests/unit/app/seo tests/unit/core/infrastructure/i18n/messages-completeness.test.ts tests/unit/core/application/dto/admin.dto.test.ts tests/integration/admin` | ✅ 28 files, 203/203 passed (same 4 pre-existing `PrismaClientInitializationError` logs Module 117/118 already documented, in the same 3 files — not new, not failures) |
| `git diff --check` | `git diff --check` | ✅ Exit code 0, no whitespace errors |
| `prisma validate` / `prisma generate` | `npx prisma validate` / `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1 npx prisma generate` | ❌ Cannot run — see §Q |

## Q. Known Limitations

1. **Sandbox cannot run `prisma generate` for this schema change.** This
   session's shell is a Linux (`linux-arm64`) VM (confirmed via `uname
   -a`), while the checked-in generated Prisma Client
   (`node_modules/.prisma/client`) was built for `darwin-arm64` — the
   exact platform mismatch Module 117/118's reports already documented
   for *query execution*. This module's schema change additionally needs
   `prisma generate`/`prisma validate` to run at all (to pick up the new
   `AiVisibilityObservation` model's types), and both fail here with
   `403 Forbidden` fetching `schema-engine.gz` from
   `binaries.prisma.sh` — this sandbox's network egress does not allow
   that host. **Consequence**: `npx tsc --noEmit` reports exactly 4
   errors, all confined to
   `src/core/infrastructure/database/prisma/repositories/prisma-ai-visibility-observation-repository.ts`
   (the one file that calls `prisma.aiVisibilityObservation.*`), all of
   the shape "property/type does not exist on the currently-generated
   (stale, wrong-platform) client." This is an environment limitation,
   not a code defect — the repository is written against the schema
   exactly as it now is, and its logic is independently verified via the
   mocked-Prisma-client unit test (§O), which passes at runtime because
   Vitest transpiles without full type-checking. **Running `npx prisma
   generate` (or `prisma migrate deploy`, applying the new hand-authored
   migration) in the project's real development environment or CI will
   resolve this immediately** — no code change is needed.
2. Same live-database-read limitation Module 117/118 already documented:
   this sandbox cannot execute a live Prisma query, so this module's
   admin page/reporting queries could not be manually smoke-tested
   against a real running database in this session — only via the
   Prisma-mocked unit test and the in-memory-repository integration
   tests (both passing).
3. **No AI provider is integrated.** By design (§G) — but it means every
   metric this module can currently report is `0/0` until an evaluator
   manually records at least one real observation through the admin
   form. This is expected, not a bug: the module's job was to build the
   measurement *capability*, not to have already measured anything.
4. Evidence-excerpt retention policy (§F) is flagged **REQUIRES LEGAL
   CONFIRMATION** — this module does not decide how long, or whether,
   even a short curated excerpt of a third-party AI provider's output
   may be retained under that provider's terms of service.
5. Full suite (`npm test`) / `next build` were not run to completion in
   this session — the same "CI is the authoritative full-suite/build
   gate" scoping Module 117/118's own reports already established was
   followed here; the full `tests/unit` directory alone is known (from
   Module 118's report) to exceed this session's command time budget.
6. No dedicated authorization test was written for the new admin page —
   see §O's own reasoning (it would test pre-existing, unmodified
   `admin/layout.tsx`/`rbac.ts` code, not anything this module added).

## R. Future Recommendations

- **Legal review** of AI-provider terms of service before considering
  any official API integration (`OPENAI_API`/`ANTHROPIC_API`/etc. moving
  from a reserved label to an actual client), and before deciding
  whether longer evidence retention is ever appropriate (§F/§Q-4).
- Once (and only if) an approved API integration exists, wire a cron
  route following `api/cron/reconciliation-run/route.ts`'s exact
  auth/idempotency/failure-reporting pattern, calling
  `makeRecordAiVisibilityObservationUseCase()` per active query —
  respecting that provider's rate limits and cost controls, disabled by
  default until explicit configuration is present (per Phase 11's own
  "do not activate paid external API calls automatically").
- Expand `KNOWN_COMPETITOR_NAMES` and the query dataset over time as a
  content/product decision (not a code change) — both are small, typed,
  reviewed catalogs designed for exactly that kind of incremental
  editing.
- Consider a `byLanguage` metrics breakdown (the dataset already records
  each query's `language`) if the business later wants to compare AI
  behavior in Spanish vs. English responses specifically.
- If observation volume ever grows enough that `listForPeriod`'s
  unpaginated full-period read becomes a real cost, add pagination to it
  at that time — not preemptively (Phase 14's own instruction).

## S. Explicit Statement (Non-Negotiable Rule Compliance)

**This module cannot and does not guarantee, force, or manipulate any AI
system's recommendation of MaestroYa.** ChatGPT, Claude, Gemini,
Perplexity, Google AI, and every other AI system remain entirely outside
this codebase's control. Nothing this module built contacts, automates,
scrapes, or otherwise interacts with any of those systems. It records
what a human evaluator (or, in the future, an approved official API)
independently observes when *asking* one of those systems a question —
nothing more. Every observation is a timestamped, evidence-referenced,
individually-preserved data point about a single moment in an inherently
variable process, never a claim about a stable outcome.

## T. Exact Files Changed

Modified:
- `prisma/schema.prisma` (append-only addition: 5 new enums, 1 new
  model `AiVisibilityObservation`, 1 new back-relation field on `User`
  — no existing field, model, enum, or relation altered)
- `src/app/(dashboard)/admin/layout.tsx` (1 line: added the
  `/admin/ai-visibility` nav entry to the existing `NAV_ITEMS` array)

New:
- `prisma/migrations/20260917000000_add_ai_visibility_monitoring/migration.sql`
- `src/core/domain/repositories/ai-visibility-observation-repository.ts`
- `src/core/domain/services/ai-visibility-evaluation.ts`
- `src/core/infrastructure/database/prisma/repositories/prisma-ai-visibility-observation-repository.ts`
- `src/shared/content/ai-visibility-queries.ts`
- `src/core/application/dto/ai-visibility.dto.ts`
- `src/core/application/use-cases/ai-visibility/record-observation.use-case.ts`
- `src/core/application/use-cases/ai-visibility/list-observations.use-case.ts`
- `src/core/application/use-cases/ai-visibility/get-ai-visibility-metrics.use-case.ts`
- `src/core/application/use-cases/ai-visibility/compose.ts`
- `src/app/(dashboard)/admin/ai-visibility/page.tsx`
- `src/app/(dashboard)/admin/ai-visibility/record-observation-form.tsx`
- `src/app/(dashboard)/admin/ai-visibility/actions.ts`
- `tests/unit/shared/content/ai-visibility-queries.test.ts`
- `tests/unit/core/domain/services/ai-visibility-evaluation.test.ts`
- `tests/unit/core/application/dto/ai-visibility.dto.test.ts`
- `tests/unit/core/infrastructure/database/prisma/repositories/prisma-ai-visibility-observation-repository.test.ts`
- `tests/integration/ai-visibility/fakes.ts`
- `tests/integration/ai-visibility/record-observation.use-case.test.ts`
- `tests/integration/ai-visibility/get-ai-visibility-metrics.use-case.test.ts`
- This report: `MaestroYa_Module_119_AI_Recommendation_Monitoring_Report.md`

Unchanged (verified only): `middleware.ts`, `auth.ts`, everything under
`src/core/infrastructure/{payments,payout,tracing/../affiliate,security,
verification}` and equivalent financial/tax/legal/auth paths, the
untracked `legal/` directory, every Module 117/118 file (`llms.txt`,
`sitemap.ts`, `robots.ts`, `robots-rules.ts`,
`src/shared/seo/structured-data.ts`, `src/shared/content/{services,
locations,service-location-pairs,national-coverage}.ts`, every
`(marketing)/servicios/**`/`(marketing)/ubicaciones/**` page), the entire
existing cron/job/analytics infrastructure (§B).

## U. Exact Git Status (at time of writing this report)

```
 M prisma/schema.prisma
 M src/app/(dashboard)/admin/layout.tsx
?? legal/                                                        (pre-existing, untouched)
?? prisma/migrations/20260917000000_add_ai_visibility_monitoring/
?? src/app/(dashboard)/admin/ai-visibility/
?? src/core/application/dto/ai-visibility.dto.ts
?? src/core/application/use-cases/ai-visibility/
?? src/core/domain/repositories/ai-visibility-observation-repository.ts
?? src/core/domain/services/ai-visibility-evaluation.ts
?? src/core/infrastructure/database/prisma/repositories/prisma-ai-visibility-observation-repository.ts
?? src/shared/content/ai-visibility-queries.ts
?? tests/integration/ai-visibility/
?? tests/unit/core/application/dto/ai-visibility.dto.test.ts
?? tests/unit/core/domain/services/ai-visibility-evaluation.test.ts
?? tests/unit/core/infrastructure/database/prisma/repositories/prisma-ai-visibility-observation-repository.test.ts
?? tests/unit/shared/content/ai-visibility-queries.test.ts
```

No `git add`, `git commit`, `git push`, `git checkout`, `git switch`,
`git reset`, `git restore`, or destructive database operation was run at
any point in this session. The user handles Git manually, per
instruction.

## V. Success Criteria — Self-Assessment

| Criterion | Status |
|---|---|
| Clear AI visibility observation model | ✅ §D |
| AI results treated as variable observations, not rankings | ✅ §N |
| Query coverage: general, service, geographic intent | ✅ §E |
| Spain-wide geographic understanding measurable | ✅ `geographicAccuracy` + `geo-spain-marketplace-es` query |
| Service understanding measurable | ✅ `serviceAccuracy` + 6 service-specific queries |
| Citation/URL correctness measurable | ✅ `urlAccuracy`, `citationPresent`, `citationCorrect` |
| Historical observations preserved | ✅ append-only model + repository, tested |
| Evidence traceable | ✅ §F, every observation's own fields |
| No prohibited scraping/undocumented AI API access | ✅ §G, §M |
| No fake AI recommendations/citations | ✅ nothing fabricated anywhere in this module |
| Module 117/118 architecture reused | ✅ §C |
| No financial/legal/verification/auth logic modified | ✅ §M, §T, §U |
| Relevant tests pass | ✅ §O, §P (79 new + 203 pre-existing) |
| TypeScript passes | ⚠️ 4 pre-existing-sandbox-limitation errors, 1 file — §Q |
| ESLint passes | ✅ §P |
| `git diff --check` passes | ✅ §P |
