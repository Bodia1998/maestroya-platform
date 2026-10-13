# Module 163 — Structured Scope Questionnaire & Estimation v2

Status: **PARTIAL — all decision-independent engineering is complete; the module is NOT complete.** The mechanism (definitions, validation, persistence, provenance, request-submission integration, customer step, i18n, publication wiring) is implemented and tested, but **no questionnaire is active**: the shipped registry is empty, because the category-by-category factor tables are a business decision that depends on D3/D4/D21, none of which is recorded as approved. Consequently no price, cap, confidence threshold, category, pilot scope or region changed, and the exit criterion "pilot categories re-priced and compared with M132 results" cannot be met. This document makes no commercial, legal or production-readiness claim.

## 1. Open decisions (blockers) — unchanged by this module

| Decision | State | What it blocks |
| --- | --- | --- |
| Factor tables (business) | not approved | Activating any questionnaire; re-pricing the pilot categories; the exit criterion. |
| **D3** rates / caps | roadmap *recommended default* only; M132 pilot snapshot is provisional and byte-for-byte unchanged | Any change to caps; large-project caps. |
| **D4** minimum confidence | open; pilot `minimumConfidence: "LOW"` unchanged | **HIGH confidence** (see §2). |
| **D21** pilot scope (categories, regions, cohort, large-project handling) | open; `reformas` still unsupported | Which categories get a questionnaire; **large-project mode** (see §6). |

## 2. HIGH confidence — reassessed and removed

The first pass made the estimator return `HIGH` whenever valid structured scope was present. That was wrong on two counts: it made confidence more permissive, and it equated *completeness of the answers* with *accuracy of the estimate*. A complete questionnaire says the customer answered every required question, not that the base value, the factor table or the rate match is right.

Now: scope **never changes confidence**. The estimator keeps the pre-M163 rule (`MEDIUM` only when the base value comes from the request's own sub-category with a parent, otherwise `LOW`), and a regression test pins that a complete scope on a category-level base stays `LOW`, and that M128's `minimumConfidence: MEDIUM` still yields `CONFIDENCE_TOO_LOW` for a scoped estimate.

A correct policy for "when may scope raise confidence" needs an approved definition of estimate accuracy (D4). **That policy is left unresolved; the precise blocker is D4.**

## 3. What is implemented

### 3.1 Domain (pure, no I/O)
* `src/core/domain/services/lead-scope-questionnaire.ts` — versioned per-category definitions (`SINGLE_CHOICE`, `INTEGER_RANGE`; required/optional; fixed-point factors, ≤ 6 fraction digits, in (0, 10.0]); definition validation including the **static worst-case bound** (the product of the worst factors must not exceed the declared `maxScopeFactor`/`maxComplexityFactor`; nothing is clamped) and `NO_REQUIRED_QUESTION` (an all-optional questionnaire could look "complete" while empty); answer evaluation (`MISSING_REQUIRED`, `UNKNOWN_QUESTION` — this is how a budget or free-text key is rejected —, `INVALID_TYPE`, `VALUE_NOT_ALLOWED`, `OUT_OF_RANGE`, `CONTRADICTORY_ANSWERS`, `ANSWERS_MALFORMED`, `INVALID_DEFINITION`); `deriveStructuredScope` / `deriveLeadV1StructuredScope` (own-slug-then-parent lookup, LEAD_V1 only, own-property lookup); `LeadScopeProvenance` (+ guards `isScopeQuestionnaireVersion`, `isStoredScopeAnswers`, `isLeadScopeProvenance`: flat, non-empty, string/safe-integer answers); `toScopeQuestionnaireView` (ids, kinds, allowed values only — **factors never leave the server**); `findScopeQuestionnaire`.
* `src/core/domain/services/job-value-estimation.ts` — optional server-derived `structuredScope` context field; absent → identical pre-M163 result; malformed → `INVALID_INPUT / INVALID_SCOPE` (never neutral); ceiling → `UNAVAILABLE` (not clamped); result records `scopeQuestionnaireVersion` only when scope was used.
* `src/core/domain/services/lead-publication.ts` — scope provenance in the price outcome, pricing and snapshot validation (version and answers together or not at all; a malformed provenance is `PRICING_RESULT_MALFORMED` / `SNAPSHOT_INVALID`, never dropped).

### 3.2 Request-submission integration (smallest consistent change — no new flow)
`leadRequestSchema` gains optional `scopeAnswers` (flat string/integer map, bounded) → `SubmitLeadRequestUseCase` validates it against the category's released questionnaire **before anything is created** (`LeadRequestScopeInvalidError`; answers present but invalid/incomplete/contradictory/unsupported, or a category with no questionnaire, are refused — never ignored, never neutral; empty `{}` is not "no scope") → `CreateLeadV1ServiceRequestUseCase` takes the validated `{questionnaireVersion, answers}` as an option and passes it to the repository → the existing publication path runs unchanged. Absent answers keep the exact pre-M163 call shape. `submit-lead-request.use-case.ts` still does not name `LEAD_FLOW_VERSION` (existing boundary contract).

### 3.3 Persistence and publication
* `ServiceRequest.scopeAnswers` / `scopeQuestionnaireVersion` — written once by `PrismaServiceRequestRepository.create` (LEAD_V1 only; malformed/legacy refused before any row is written); `update()` never touches them.
* The publication price source (`EstimatedValueLeadPricingContextReader` ← `ConfiguredLeadPublicationPriceSource`, shared by publication and the purchase price provider through `makeLeadScopeEstimationSource`) **re-derives** the factors from the stored answers against the *current* definition at publication time. The stored questionnaire version must equal the definition's version; otherwise (tampered/invalid answers, version mismatch, category without questionnaire, non-LEAD_V1, ceiling) the lead is **UNPRICED — fail closed**, never priced as "no scope". No stored scope → estimated exactly as before.
* On success the version + answers are copied into the immutable publication snapshot (`leads.publicationScopeQuestionnaireVersion` / `publicationScopeAnswers`) in the same single conditional write as the rest of the snapshot, so the price is reproducible from `answers + questionnaire version + publicationJobValueRuleVersion`.

### 3.4 Customer UI and i18n
Server page offers a category's questionnaire only when **every** label/option key exists in the message catalog (a question without a translation is never shown). The form renders the step for the selected category (select / whole-number input), keeps answers per questionnaire (no carry-over between categories), omits blanks, sends non-integer text as text so the server refuses it, and shows server refusals next to the offending question. Generic strings (`sections.scope*`, `scope.selectOption`, `scope.integerHint`, `scope.errors.*`, `errors.scopeInvalid`) exist in all 12 locales. **Per-question label keys (`scopeQuestions.<category>.<question>.label|options.<value>`) are not authored**, because no questionnaire exists; a test fails if a released questionnaire lacks any in any locale (vacuous today).

### 3.5 Registry
`src/core/infrastructure/pricing/lead-scope-questionnaires.v1.ts` — **empty and frozen**. Activating a category is a reviewed edit of this file once the owner approves a table; until then every scope answer is refused and the customer step is never offered.

## 4. Failure behaviour

| Situation | Result |
| --- | --- |
| No answers submitted | No stored scope; estimate exactly as before M163 |
| Answers submitted, category has no questionnaire (today: always) | `LeadRequestScopeInvalidError` — nothing created |
| Answers invalid / incomplete / contradictory / budget-shaped key / wrong type | Refused with question ids + reason codes (never the values) — nothing created |
| Malformed provenance reaching the use case, repository or snapshot | Refused before any write |
| Stored scope tampered, or questionnaire version changed before publication | Lead UNPRICED (not published); never neutral |
| Non-LEAD_V1 flow | Scope refused by the repository, the DB CHECK, the derivation and the estimator |
| Value above ceiling | `UNAVAILABLE / VALUE_EXCEEDS_CEILING` (not clamped) |
| Price above cap | Capped by M128 (unchanged) |

## 5. Migration impact — `20261027000000_add_module_163_scope_questionnaire_provenance`

Additive and hand-authored (same caveat as earlier migrations). Four **nullable** columns (`service_requests.scopeAnswers JSONB`, `scopeQuestionnaireVersion TEXT`; `leads.publicationScopeQuestionnaireVersion TEXT`, `publicationScopeAnswers JSONB`); no column dropped/renamed/rewritten, no row updated — every existing row keeps all four NULL; `lead_purchases` and every financial table untouched.

* **M133 CHECK:** `leads_publication_snapshot_all_or_nothing` (`num_nonnulls(...) IN (0, 10)`) is **not modified** and the new columns are **not part of it**, so a lead published without scope still satisfies it with the new columns NULL. The new columns carry their own CHECKs.
* Five new CHECKs: requests — answers/version both-or-neither, non-empty object + version shape, LEAD_V1 only; leads — both-or-neither, and (non-empty object, version shape, only when `publishedAt IS NOT NULL`).
* **One existing object is replaced:** the function `leads_publication_snapshot_immutable()` (same name, same trigger) is redefined (`CREATE OR REPLACE`) to also guard the two new columns, so provenance is immutable once published, exactly like the rest of the snapshot. Rollback: drop the five constraints and four columns, and re-run M133's function definition.
* **Limitation (in-flight drafts):** a request stored under questionnaire version *N* whose definition is later bumped to *N+1* before publication is left UNPRICED (by design — fail closed, not silently re-priced). Whether such drafts should be re-asked, expired or migrated is an operational policy not specified in the roadmap.
* **Limitation:** the purchase snapshot (`LeadPurchase`) does not copy scope provenance; purchase-time pricing reads the stored publication snapshot of the lead, which carries it.

## 6. Not implemented, and why

* **Large-project mode** — not implemented. The roadmap does not define the threshold, the higher caps, or the buyer/quote policy for large projects; those need D21 (scope) and D3 (caps) decisions that must not be invented. **Missing decision:** the large-project threshold(s), cap(s) and buyer policy.
* **Factor tables / active questionnaires / per-question translations** — need the business decision (§1).
* **Re-pricing the pilot categories vs M132** (exit criterion) — needs approved tables.
* **HIGH-confidence policy** — D4 (§2).
* **M156 gaming signals** on implausible answer patterns — out of M163's scope.

## 7. Tests (added or changed in this pass)

* `lead-scope-questionnaire-m163.test.ts` (extended): provenance guards, view without factors, `findScopeQuestionnaire`, `deriveLeadV1StructuredScope`, `NO_REQUIRED_QUESTION`, empty registry.
* `job-value-estimation-structured-scope-m163.test.ts` (updated): scope never raises confidence; MEDIUM only from a sub-category base; real pilot pipeline.
* `lead-scope-questionnaire-boundary-contract-m163.test.ts` (updated): registry imported only by composition roots; structured scope confined to its modules; migration present and additive; wiring present; Submit does not name the flow constant.
* New: `lead-publication-scope-m163.test.ts` (domain guards); `scope-estimation-m163.test.ts` (stored scope through the real estimator wiring: reproducibility, version mismatch, 6 tampered shapes, empty registry, legacy, ceiling); `scope-submission-m163.test.ts` (DTO, Submit, Create, list view); `scope-reproducibility-m163.test.ts` (in-memory end to end); `publish-lead-scope-m163.test.ts`; `prisma-scope-persistence-m163.test.ts` (request create, snapshot write/read, reader); `lead-scope-migration-m163.test.ts` (static SQL contract); `lead-scope-i18n-m163.test.ts`; additions to `lead-request-actions/form/page` tests; `tests/test-utils/scope-questionnaire-fixtures.ts` and `tests/unit/i18n/scope-issue-codes.ts` (test-only; fixture factors are arbitrary and not a policy).

## 8. Verification (exact)

Environment: the repository's `node_modules` are macOS-built and Prisma engine downloads return 403, so verification ran in a scratch copy of the working tree (Linux, Node, Prisma client generated against a stub query engine). **No database was used by the unit suite.**

| Check | Command | Result |
| --- | --- | --- |
| Unit tests | `vitest run tests/unit` (run in 4 groups: `core/domain`, `core/application`, `core/infrastructure`, and the rest) | **722 files, 7856 tests — all passed** |
| Typecheck | `tsc --noEmit -p tsconfig.json` | exit 0 |
| Lint | `eslint` on every changed/new `.ts`/`.tsx` file | exit 0 |
| Prisma | `prisma validate` (dummy URLs) | schema valid |
| Whitespace | `git diff --check` | clean |
| Migration SQL | executed in-memory on PGlite (WASM Postgres, disposable) against stub `service_requests`/`leads` tables after applying the real M133 migration, then M163: both applied; legacy-row scope, half pairs, empty/array answers, bad version, scope on a draft, half scope on publish, partial M133 snapshot all **rejected**; publish with and without scope **accepted**; mutating/removing/adding provenance or mutating the M133 price after publish **rejected** by the trigger; unrelated updates allowed; existing rows keep NULL | all as expected |

**Could not run (environment):** `tests/integration-db` and e2e (no PostgreSQL; Prisma engines not downloadable); `prisma migrate` against a real schema (the PGlite check above used stub tables, not the full schema). The suite also reports ~15 *unhandled* Prisma-engine rejections in unrelated test files (`admin-layout-authorization`, stripe webhook routes, SEO metadata, …) caused by the stub engine; none originate in M163 files and no test failed.

Repository files already fail `prettier --check` at HEAD, so no reformatting was applied.

## 9. Follow-up

1. Owner approves per-category factor tables and D3/D4/D21 → add reviewed definitions and the translations; the i18n gate then becomes non-vacuous.
2. Run `tests/integration-db` and `prisma migrate` on a disposable PostgreSQL.
3. Decide in-flight-draft policy on a questionnaire version bump.
4. Decide large-project mode (D21/D3) and the confidence policy (D4).
5. Re-price the pilot categories and compare with M132 (exit criterion).
