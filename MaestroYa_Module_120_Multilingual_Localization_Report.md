# MaestroYa — Module 120: Multilingual Localization Report

Date: 2026-09-24 · Scope: full UI localization audit + implementation, Russian (`ru`) and Dutch (`nl`) added.

## 1. Executive summary

**Why the language switch did not work.** The switching *mechanism* (next-intl, cookie + `User.preferredLocale`, `router.refresh()`) was sound. The problem was that almost nothing read from the catalog: before this module only **5 of 245** UI files used translations. About **2,000 user-facing strings** were hardcoded, **~2,140 of them in English**, even under the Spanish default. On top of that, 600+ English domain-error messages, ~220 English Zod DTO messages, stored English notification text and English auth e-mails were shown to users directly.

**What was done.** The existing architecture was **extended, not replaced**: same next-intl setup, same resolution chain, no locale URL segment, no second framework, no database migration.
- Locales: `ru` and `nl` added (10 → 12 locales).
- Catalog: grown from ~150 keys to **2,803 keys** (es/en), organised in 24 namespaces.
- Code: every user-facing string in `src/app` and `src/presentation` now comes from the catalog.
- Validation, domain errors, notifications, auth e-mails and SMS are now localized at the edges; domain logic still has no locale.
- Service/location knowledge content is translated.
- Guards: tests fail on missing keys, on ICU-argument mismatches between locales, and on newly hardcoded strings.

**Coverage.** Localization coverage was verified statically for **63/63 identified user-facing areas that exist in the codebase**: 0 hardcoded candidates remain, every catalog key is present in every locale, the type-checker validates `t("key")`, and render tests exist per area. In the requirement list, **5 areas have no UI in the repository** (see §6). **Admin is localized in Spanish + English only**, a product decision recorded in §6. Nothing was verified in a running browser in this environment (see §11), so the manual checklist in §17 is the remaining acceptance step.

## 2. Existing localization architecture (audit findings)

| Aspect | Finding |
|---|---|
| Library | `next-intl` 4.x in "without i18n routing" mode (`src/i18n/request.ts` → `getRequestConfig`) |
| Locales | `src/shared/i18n/locales.ts`, a single source of truth: `es` (default), en, uk, cs, de, fr, it, pt, ro, pl |
| Routing | No `/[locale]` segment, by design. URLs, `callbackUrl`s and protected prefixes are locale-free (Module 29). |
| Resolution | Authenticated: `User.preferredLocale` → Accept-Language → `es`. Guest: `NEXT_LOCALE` cookie (mirrors localStorage `maestroya_locale`) → Accept-Language → `es`. Middleware forwards the negotiated header `x-maestroya-locale`. |
| Switcher | `language-switcher.tsx` + `I18nProvider`: writes cookie + localStorage, `PATCH /api/user/language` for signed-in users, then `router.refresh()` (no navigation, no lost state) |
| Fallback | `message-loader.ts` deep-merges every locale over Spanish, per key |
| Catalog | 12 namespaces × 10 locales, ~150 keys, statically imported in `message-catalog.ts` |
| Validation helpers | `validation-messages.ts` existed (error map, key pattern), but DTOs still carried English prose |
| SMS | Its own per-recipient catalog (`sms-message-catalog.ts`) |

Verdict: the architecture is sound and was kept. The defect was coverage, not design.

## 3. Problems discovered

1. **5/245 UI files localized.** Header, mobile nav, user menu, switcher and profile page only. Everything else was hardcoded, mixing English (dashboards, auth, forms, admin) and Spanish (home, footer, SEO pages).
2. **Domain errors reached the UI verbatim** via `error.message` (639 throw sites, ~290 distinct static messages, all English).
3. **Zod DTO messages were English prose** (306 message arguments in 30 DTO files). Client forms used plain `zodResolver`, and server actions returned `issues[0].message`.
4. **Notifications** were stored and delivered with English `title`/`message`.
5. **Auth e-mails** (verification, password reset) had English subject and body composed inline in the use cases.
6. **Dates and money** used `toLocaleString()` without the active locale or with hardcoded `"es-ES"`/`EUR` formatting. Plurals were built in code (`user${n===1?"":"s"}`).
7. **Status labels** came from a hardcoded English map in `StatusBadge`.
8. **Service category names** are stored once, in Spanish, in `ServiceCategory.name`.
9. **Module 118 knowledge content** was Spanish-only prose inside TS files.
10. **Test infrastructure** had no next-intl setup, so migrated components could not render in tests.
11. **Minor:** the `sms` namespace was loaded by its own catalog only, and `server-locale.ts` is a leftover empty stub.

## 4. Languages before / after

| Before (10) | After (12) |
|---|---|
| es (default), en, uk, cs, de, fr, it, pt, ro, pl | es (default), en, uk, cs, de, fr, it, pt, ro, pl, **ru (Русский)**, **nl (Nederlands)** |

The existing codes were kept; the new codes follow the same ISO 639-1 convention. The picker order is default first, then order of addition. `ru` and `nl` are appended, so the switcher lists 12 entries.

## 5. Architecture changes (additive)

- **Catalog.** One static `src/i18n/messages/<locale>/index.ts` per locale. `message-catalog.ts` now has 12 imports instead of ~140 lines.
- **New namespaces:** `errors`, `enums`, `ui`, `customer`, `professional`, `company`, `partner`, `services`, `knowledge`, `seo`, `notificationTemplates`. There are 24 in total including `sms`.
- **Typed keys.** `src/i18n/next-intl.d.ts` registers the Spanish catalog as `AppConfig.Messages`, so `t("unknown.key")` is a compile error.
- **Client payload.** `selectClientMessages()`: `emails`, `seo`, `knowledge` are server-only, and `admin` is sent only to admins. This keeps the browser payload down.
- **Errors** (`src/presentation/i18n/error-messages.ts`, `server.ts`, `hooks/use-localized-errors.ts`). `localizeError` resolves a user message in this order:
  1. exact static domain message → `errors.domain.*` (registry of 232 messages / 228 keys);
  2. error code → `errors.byCode.*`;
  3. the caller's localized fallback.

  Domain code is unchanged and keeps its English developer messages for logs and Sentry.
- **Validation.** DTOs carry keys only: generic `VALIDATION_KEYS` or dotted `dto.*` keys (124). Client forms use `useLocalizedZodResolver`, which translates both keys and Zod built-ins. Actions use `localizeZodError` / `localizeZodFieldErrors`. Zod's own English defaults are re-derived from the issue code.
- **Service categories.** `localizeCategoryName(t, {slug, name})` returns the catalog entry `services.categories.<slug>`, falling back to the DB value. **No schema change, no data duplication.**
- **Notifications.** `localizeNotification` renders `notificationTemplates.<TYPE>` from `type` + `metadata` at read/delivery time, falling back to the stored text. Stored rows are never rewritten. Delivery locale:
  - in-app: the request locale;
  - e-mail/realtime: the recipient's `preferredLocale` → `es`.
- **Auth e-mails.** New `AuthEmailComposer` port with an infrastructure implementation (`use-intl/core`), injected in `auth/compose.ts`. Register uses the request locale. Reset uses the stored preference, then the request locale, then `es`. Tokens, TTLs, URLs and anti-enumeration behaviour are unchanged.
- **Status labels.** `StatusBadge` uses `enums.status.*` (38 statuses).
- **Test setup.** `tests/test-utils/intl.ts` + `intl-setup.ts` (Vitest `setupFiles`): next-intl resolves to English by default, and `setTestLocale()` switches it.
- **Tooling.**
  - `scripts/i18n-missing-keys.mjs`: key parity and ICU-argument parity per namespace.
  - `scripts/i18n-hardcoded-scan.cjs`: TypeScript-AST scanner. Exemptions need an `i18n-ignore` comment with a reason; there are 126.
- **Conventions and glossary:** `docs/MODULE_120_LOCALIZATION_CONVENTIONS.md`.

## 6. Areas localized

Scanner baseline was 2,022 candidates in 241 files. After the work it is **0**.

| Area | Items | Status |
|---|---|---|
| Public site (16) | home, services, service detail, locations, location detail, search, professionals directory, professional profile, company profile, navigation, footer, CTAs, empty states, error page, 404, metadata | ✅ 16/16 |
| Auth (8) | login, register, verify email, forgot password, reset password, auth errors, validation, success messages | ✅ 8/8 (anti-enumeration preserved) |
| Customer (12) | profile, service requests, quotes, quote details, quote acceptance, jobs, payment UI, receipts, reviews, disputes, notifications (in-app via server action), settings (language) | ✅ 12/12 |
| Professional (10 existing) | onboarding, verification + status, profile, services, quotes, requests, jobs, appointments, invoices, self-billing | ✅ 10/10 |
| Company (5 existing) | dashboard/onboarding, profile, members, invitations + accept, verification, self-billing | ✅ 5/5 |
| Affiliate (6) | registration/no-account state, dashboard, earnings stats, payout panel, referral links/campaigns, status/error messages | ✅ 6/6 |
| Admin (1) | full admin panel: 663 keys | ✅ **es + en only** (decision below) |
| Cross-cutting (5) | DTO validation, domain errors, notifications (in-app, e-mail, realtime), auth e-mails, SMS (ru/nl added) | ✅ 5/5 |

Totals: 16 + 8 + 12 + 10 + 5 + 6 + 1 + 5 = **63/63**.

**Not present in the codebase:**
- professional earnings page, payouts page, and a dedicated professional/company settings page (there is no UI under those paths; only the related actions exist, and those are localized);
- a company quotes/jobs view;
- an in-app notification list UI (the server action is localized).

**Admin decision.** The admin panel is an internal staff tool. It is localized into **Spanish and English only**. Other locales fall back deterministically to Spanish. The completeness test exempts `admin` for non-es/en locales explicitly (a documented product decision, not a gap).

**Deliberately not translated:**
- user-generated content: requests, chat, dispute messages, reviews, names, addresses, portfolio;
- city/province names;
- brand names;
- confirmation tokens `DELETE`/`DEACTIVATE`/`TRANSFER`, because the schema checks those exact words;
- technical identifiers in admin tables (audit codes, discrepancy types);
- backend-generated English diagnostics stored in admin data (discrepancy explanation, fraud-flag detail, payout `failureReason`);
- the AI-visibility evaluation query dataset.

## 7. Russian implementation

- Complete across all 23 fully-required namespaces: **2,151 keys**. That is identical to every other non-es/en locale: every non-admin key plus the original admin navigation keys.
- Register **«вы»**, modern neutral Russian.
- Terminology per glossary: заявка (request), смета (quote), заказ (job), визит (appointment), специалист (professional), выплата (payout), спор (dispute), счёт (invoice).
- ICU plurals use `one/few/many/other` (verified by test: 3 ≠ 5).
- Browser tags `ru-*` resolve to `ru`.

## 8. Dutch implementation

- Complete: **2,151 keys**.
- Standard Dutch, informal **«je»**, professional tone.
- Terminology per glossary: aanvraag, offerte, opdracht, afspraak, vakman/vakmensen, uitbetaling, geschil, factuur.
- Plurals use `one/other`.
- Browser tags `nl-*` resolve to `nl`.

## 9. Translation completeness

| Locale | Keys |
|---|---|
| es, en | 2,803 (incl. 663 admin) |
| uk, cs, de, fr, it, pt, ro, pl, ru, nl | 2,151 each (all non-admin keys + 11 original admin keys) |

- `node scripts/i18n-missing-keys.mjs` → **All locales complete.**
- `messages-completeness.test.ts` asserts, for every locale:
  - same key set as `es` (admin exemption documented);
  - no orphan keys;
  - no empty messages;
  - **identical ICU argument names**;
  - every message renders with next-intl's engine without throwing or leaking braces;
  - key-by-key Spanish fallback never yields `undefined`;
  - server-only namespaces never reach the client.
- Existing 8 locales were extended to the full key set; existing terminology was kept.
- Translations were produced by the implementation (AI) and **have not been reviewed by native speakers** (see §11).

**Fallback strategy (deterministic, tested):**
1. Requested locale (account preference, or guest cookie).
2. If invalid or unsupported, the browser's Accept-Language primary subtag (`ru-UA` → `ru`).
3. Otherwise `es`.
4. A missing key in any locale renders the Spanish string, never a raw key or `undefined`.
5. A missing key in `es` is a **tsc error**, so it cannot ship.

## 10. Locale switching behaviour

- The switching logic itself is unchanged. It now takes effect across the whole UI because every screen reads the catalog.
- Server-rendered text, Server Action messages, validation errors, domain errors, status badges, metadata, formatted dates/numbers/money (`getFormatter`/`useFormatter`, `formatCurrencyFromMinorUnits`) and ICU plurals all follow the active locale.
- Persistence: cookie + localStorage for guests; `User.preferredLocale` for accounts, which survives logout/login and devices.
- Switching refreshes in place: page, scroll and form state are kept.
- The `<Toaster />` was moved inside the i18n provider so toasts are localized too.

## 11. SEO / AI localization changes

- **One URL per page, by design.** There are no per-locale URLs and no thin localized pages. Canonicals are unchanged.
- **hreflang is intentionally not emitted.** Alternate-language URLs do not exist, and pointing hreflang at the same URL would be incorrect. This is documented in code.
- **Crawlers get Spanish.** A crawler without cookie/Accept-Language gets Spanish (unchanged).
- **Metadata** (title, description, OG title/description/`og:locale`) follows the active locale via `generateMetadata`. The `ru_RU` / `nl_NL` OG locales were added.
- **JSON-LD:** Service and FAQ nodes carry `inLanguage` and localized text. Organization/WebSite are unchanged. The **national coverage vs verified local availability** wording is preserved in every language.
- **Knowledge content** (Module 118): prose moved to `knowledge.*` with Spanish verbatim, translated into 11 locales under the Module 118 content rules. There are no price, guarantee, availability, rating or 24/7 claims, and a test checks English for price/guarantee claims.
- **`sitemap.ts`, `robots.ts`, `llms.txt`** remain single-language (Spanish canonical) and never read the request locale. Their output is unchanged.
- **Deployment note:** because language varies per visitor on the same URL, any CDN/cache in front must vary on the `NEXT_LOCALE` cookie and `Accept-Language`, or keep these routes dynamic (they already render dynamically).

## 12. E-mails, notifications and legal/financial documents

- **E-mails and notifications:**
  - Verification and password-reset e-mails are localized (all 12 locales).
  - There are 46 emitted notification types, with 127 template keys covering wording variants and labels. They are localized in-app, by e-mail and in realtime.
  - SMS already used the recipient locale; `ru`/`nl` templates were added and tested.
  - Web push is a no-op stub (no text).
  - No invoice, payout, payment or affiliate e-mails exist in the codebase.
- **Legal documents:** invoice, receipt and self-billing **document bodies** keep the wording they were issued with (Spanish). They are rendered in a `lang="es"` block with a localized notice that the document is shown in its issued language. Only the UI chrome is translated.
- **No change** to commission, IVA, IRPF, invoicing, self-billing rules, Stripe, payouts, verification requirements or affiliate calculations.

**Items flagged for legal/native review:**
1. **Professional invoice detail:** Spanish document labels chosen by the implementation (Número de factura, Emisor, Destinatario, Base imponible, IVA, Facturas rectificativas, …). Credit-note line descriptions are generated in English by `create-credit-note.use-case.ts`, so they appear in English inside that block.
2. **Customer receipt:** should labels such as "Taxable base / Issued by / Billed to" stay in Spanish? The "tamper-evidence checksum only — not an electronic signature" disclaimer is now translated into 12 languages.
3. **Self-billing pages (professional and company):** the explanatory sentences around the Spanish legal term "facturación por el destinatario" (which stays untranslated) are translated. They describe the effect of an authorisation, so they need legal review.
4. **Affiliate:** text such as "in exchange for a share of the platform's profit", the payout threshold and earnings labels are translated literally.
5. **Marketing claims** (trust section, verification descriptions, "Made in Spain…") are translated faithfully. `seo.site.description` mentions cleaning/limpieza, which is not a seeded category; this is pre-existing wording.
6. **Error wording:** "factura rectificativa" in error texts, and the phrasing of `issuerTaxIdNotConfigured`.
7. **Admin Spanish:** Spanish text in admin partner-payout help and the reconciliation read-only notice.

## 13. Tests performed

**New:**
- `tests/unit/core/infrastructure/i18n/messages-completeness.test.ts` (rewritten)
- `tests/unit/i18n/no-hardcoded-strings.test.ts`
- `tests/unit/shared/i18n/validation-keys-coverage.test.ts`
- `tests/unit/presentation/i18n/domain-error-message-keys.test.ts`
- `tests/unit/shared/i18n/notification-templates.test.ts`
- `tests/unit/core/infrastructure/notifications/recipient-notification-localizer.test.ts`
- `tests/unit/core/infrastructure/email/intl-auth-email-composer.test.ts`
- `tests/unit/app/marketing-auth-localization.test.tsx`
- `tests/unit/presentation/customer-area-i18n.test.tsx`
- `tests/unit/presentation/company-partner-i18n.test.tsx`
- `tests/unit/presentation/admin-i18n.test.tsx`
- ru/nl negotiation and fallback cases in `negotiate-locale.test.ts`
- ru/nl registration in `locales.test.ts`
- 12-locale switcher assertion in `language-switcher.test.tsx`
- per-locale label coverage in `status-badge.test.tsx`
- ru/nl render tests for service/location/knowledge pages, pagination, password input, quote form, and canonical stability across locales (under `tests/unit/app/seo`, `tests/unit/shared/content`)

**Updated:** tests asserting old hardcoded text or the old English domain message. For example, `change-user-role-server-action.test.ts` now expects the localized "super admin" sentence; the rejection itself is unchanged.

## 14. Test results (executed on the linked machine: Linux VM, 4 cores / 3 GB)

| Command | Result |
|---|---|
| `npx tsc --noEmit --incremental false` | ✅ 0 errors |
| `npx eslint . --max-warnings=0` | ✅ clean |
| `git diff --check` | ✅ clean |
| `node scripts/i18n-missing-keys.mjs` | ✅ All locales complete |
| `node scripts/i18n-hardcoded-scan.cjs src/app src/presentation` | ✅ 0 candidates |
| Localization suites (10 files) | ✅ 162/162 |
| `tests/unit/app + presentation + shared + i18n + middleware + next.config + regression` | ✅ 852/852 |
| `tests/unit/core/domain` | ✅ 1,289/1,289 |
| `tests/unit/core/application + tests/unit/prisma*` | ✅ 1,079/1,079 |
| `tests/unit/core/infrastructure` (two batches) | ✅ 507/507 + 756/756 |
| `tests/integration` (two batches) | ✅ 570/570 + 440/440 |

**Total: 5,493 tests passed, 0 failed.** Notes:
- Vitest reports **unhandled `PrismaClientInitializationError`s** in some runs: the committed Prisma client was generated for `darwin-arm64` and cannot load on this Linux VM. They are environmental and do not affect results; they will not occur on your Mac.
- `npm test` was run as the equivalent directory batches, because of the VM's 180-second-per-command limit.
- **Not executed:** `tests/integration-db` (needs PostgreSQL), Playwright e2e (needs a running app and browser), `next build`.
- With the stale incremental cache, `tsc` can report phantom namespace errors. Use `--incremental false` or delete `tsconfig.tsbuildinfo` once.

## 15. Remaining limitations

1. **No browser verification here**: the app and DB could not run in this environment. Please run the checklist in §17.
2. **Native review**: ru/nl and all other translations are AI-authored, not native-reviewed.
3. **Admin**: Spanish and English only, by decision.
4. **Chat system messages** (`chat-job-notifier`, `chat-appointment-notifier`) are stored as English chat text and are not localized.
5. **Old notification rows** without the needed metadata show their stored English text; new rows render localized.
6. **Search ranking reasons**: the domain `RankingEngine` produces English sentences. A presentation mapper translates the known ones; if someone rewords a reason, it shows in English again.
7. **Item limits** in the `dto.quote.itemsMax` / `materialsMax` messages (20 and 50) are written into each translation. Update the translations if those constants change.
8. **String lag on switch**: client strings update one `router.refresh()` after the switch (pre-existing, Module 29).
9. **Cleanup needed** (the sandbox cannot delete files; please delete manually):
   - `.probe-prof/` (a temporary type-check folder, now `export {}`);
   - `src/core/infrastructure/i18n/server-locale.ts` (an empty stub from Module 29);
   - `renderActionLinkEmailHtml` in `email-template.ts` is now unused.
10. `docs/MODULE_29_INTERNATIONALIZATION.md` still describes 10 locales; `docs/MODULE_120_LOCALIZATION_CONVENTIONS.md` is the current reference.

**Unrelated defects noticed (not fixed):**
- The footer "Únete como profesional" link lacks `?intent=professional`.
- The delete-account form pre-fills the `DELETE` confirmation.
- Pages that set their own `openGraph` lose the root `siteName`/`type`.
- `GetProfessionalQuotesUseCase` uses English "Unknown"/"Service request" fallbacks.

## 16. Files changed

- **Totals:** ~430 tracked files modified and ~30 new files/folders.
- **Translations:** 24 namespaces × 12 locales under `src/i18n/messages/`, plus the new per-locale `index.ts`.
- **Database/migrations: none.**
  - `prisma/schema.prisma` and `prisma/migrations/` are untouched.
  - Additive read-model changes: `ServiceRequestRecord.categorySlug`, plus Prisma selects for `category.slug`.
  - Additive notification `metadata` fields: `role` in company-membership notifications, `requestTitle` in request-expiry notifications.

**Non-catalog file list:**

- M `src/app/(dashboard)/admin/actions.ts`
- M `src/app/(dashboard)/admin/admin-nav.tsx`
- M `src/app/(dashboard)/admin/ai-visibility/actions.ts`
- M `src/app/(dashboard)/admin/ai-visibility/page.tsx`
- M `src/app/(dashboard)/admin/ai-visibility/record-observation-form.tsx`
- M `src/app/(dashboard)/admin/analytics/actions.ts`
- M `src/app/(dashboard)/admin/audit-logs/page.tsx`
- M `src/app/(dashboard)/admin/companies/[id]/page.tsx`
- M `src/app/(dashboard)/admin/companies/actions.ts`
- M `src/app/(dashboard)/admin/companies/page.tsx`
- M `src/app/(dashboard)/admin/company-verifications/[id]/page.tsx`
- M `src/app/(dashboard)/admin/company-verifications/actions.ts`
- M `src/app/(dashboard)/admin/company-verifications/page.tsx`
- M `src/app/(dashboard)/admin/disputes/[id]/admin-dispute-actions.tsx`
- M `src/app/(dashboard)/admin/disputes/[id]/page.tsx`
- M `src/app/(dashboard)/admin/disputes/actions.ts`
- M `src/app/(dashboard)/admin/disputes/page.tsx`
- M `src/app/(dashboard)/admin/jobs/actions.ts`
- M `src/app/(dashboard)/admin/jobs/page.tsx`
- M `src/app/(dashboard)/admin/layout.tsx`
- M `src/app/(dashboard)/admin/page.tsx`
- M `src/app/(dashboard)/admin/partners/[id]/page.tsx`
- M `src/app/(dashboard)/admin/partners/actions.ts`
- M `src/app/(dashboard)/admin/partners/page.tsx`
- M `src/app/(dashboard)/admin/portfolio/page.tsx`
- M `src/app/(dashboard)/admin/professionals/page.tsx`
- M `src/app/(dashboard)/admin/quotes/page.tsx`
- M `src/app/(dashboard)/admin/reconciliation/_components/badges.tsx`
- M `src/app/(dashboard)/admin/reconciliation/_components/trigger-run-dialog.tsx`
- M `src/app/(dashboard)/admin/reconciliation/actions.ts`
- M `src/app/(dashboard)/admin/reconciliation/discrepancies/[id]/page.tsx`
- M `src/app/(dashboard)/admin/reconciliation/discrepancies/[id]/resolve-discrepancy-dialog.tsx`
- M `src/app/(dashboard)/admin/reconciliation/discrepancies/page.tsx`
- M `src/app/(dashboard)/admin/reconciliation/jobs/[jobId]/page.tsx`
- M `src/app/(dashboard)/admin/reconciliation/page.tsx`
- M `src/app/(dashboard)/admin/reconciliation/runs/[id]/page.tsx`
- M `src/app/(dashboard)/admin/reconciliation/runs/page.tsx`
- M `src/app/(dashboard)/admin/reviews/page.tsx`
- M `src/app/(dashboard)/admin/security/actions.ts`
- M `src/app/(dashboard)/admin/service-requests/page.tsx`
- M `src/app/(dashboard)/admin/support-tickets/[id]/admin-support-ticket-actions.tsx`
- M `src/app/(dashboard)/admin/support-tickets/[id]/page.tsx`
- M `src/app/(dashboard)/admin/support-tickets/actions.ts`
- M `src/app/(dashboard)/admin/support-tickets/page.tsx`
- M `src/app/(dashboard)/admin/users/page.tsx`
- M `src/app/(dashboard)/admin/verifications/[id]/page.tsx`
- M `src/app/(dashboard)/admin/verifications/actions.ts`
- M `src/app/(dashboard)/admin/verifications/page.tsx`
- M `src/app/(dashboard)/analytics/actions.ts`
- M `src/app/(dashboard)/appointments/[id]/appointment-actions.tsx`
- M `src/app/(dashboard)/appointments/[id]/page.tsx`
- M `src/app/(dashboard)/appointments/actions.ts`
- M `src/app/(dashboard)/appointments/appointment-status-badge.tsx`
- M `src/app/(dashboard)/appointments/page.tsx`
- M `src/app/(dashboard)/dashboard/company/[companyId]/company-tab-nav.tsx`
- M `src/app/(dashboard)/dashboard/company/[companyId]/invitations/actions.ts`
- M `src/app/(dashboard)/dashboard/company/[companyId]/invitations/cancel-invitation-button.tsx`
- M `src/app/(dashboard)/dashboard/company/[companyId]/invitations/page.tsx`
- M `src/app/(dashboard)/dashboard/company/[companyId]/members/actions.ts`
- M `src/app/(dashboard)/dashboard/company/[companyId]/members/page.tsx`
- M `src/app/(dashboard)/dashboard/company/[companyId]/members/remove-member-button.tsx`
- M `src/app/(dashboard)/dashboard/company/[companyId]/members/transfer-ownership-dialog.tsx`
- M `src/app/(dashboard)/dashboard/company/[companyId]/profile/page.tsx`
- M `src/app/(dashboard)/dashboard/company/[companyId]/self-billing/actions.ts`
- M `src/app/(dashboard)/dashboard/company/[companyId]/self-billing/page.tsx`
- M `src/app/(dashboard)/dashboard/company/[companyId]/verification/actions.ts`
- M `src/app/(dashboard)/dashboard/company/[companyId]/verification/page.tsx`
- M `src/app/(dashboard)/dashboard/company/accept-invitation/actions.ts`
- M `src/app/(dashboard)/dashboard/company/accept-invitation/page.tsx`
- M `src/app/(dashboard)/dashboard/company/actions.ts`
- M `src/app/(dashboard)/dashboard/company/page.tsx`
- M `src/app/(dashboard)/dashboard/page.tsx`
- M `src/app/(dashboard)/dashboard/partner/actions.ts`
- M `src/app/(dashboard)/dashboard/partner/campaign-manager.tsx`
- M `src/app/(dashboard)/dashboard/partner/page.tsx`
- M `src/app/(dashboard)/dashboard/partner/payout-panel.tsx`
- M `src/app/(dashboard)/dashboard/professional/actions.ts`
- M `src/app/(dashboard)/dashboard/professional/analytics/actions.ts`
- M `src/app/(dashboard)/dashboard/professional/appointments/[id]/page.tsx`
- M `src/app/(dashboard)/dashboard/professional/appointments/page.tsx`
- M `src/app/(dashboard)/dashboard/professional/deactivate-professional-dialog.tsx`
- M `src/app/(dashboard)/dashboard/professional/invoices/[id]/page.tsx`
- M `src/app/(dashboard)/dashboard/professional/invoices/actions.ts`
- M `src/app/(dashboard)/dashboard/professional/invoices/page.tsx`
- M `src/app/(dashboard)/dashboard/professional/jobs/[id]/page.tsx`
- M `src/app/(dashboard)/dashboard/professional/jobs/page.tsx`
- M `src/app/(dashboard)/dashboard/professional/onboarding/page.tsx`
- M `src/app/(dashboard)/dashboard/professional/onboarding/professional-onboarding-form.tsx`
- M `src/app/(dashboard)/dashboard/professional/page.tsx`
- M `src/app/(dashboard)/dashboard/professional/portfolio/actions.ts`
- M `src/app/(dashboard)/dashboard/professional/professional-profile-form.tsx`
- M `src/app/(dashboard)/dashboard/professional/professional-services-form.tsx`
- M `src/app/(dashboard)/dashboard/professional/quotes/[id]/edit/page.tsx`
- M `src/app/(dashboard)/dashboard/professional/quotes/[id]/page.tsx`
- M `src/app/(dashboard)/dashboard/professional/quotes/actions.ts`
- M `src/app/(dashboard)/dashboard/professional/quotes/page.tsx`
- M `src/app/(dashboard)/dashboard/professional/quotes/quote-form.tsx`
- M `src/app/(dashboard)/dashboard/professional/quotes/withdraw-quote-dialog.tsx`
- M `src/app/(dashboard)/dashboard/professional/requests/[id]/page.tsx`
- M `src/app/(dashboard)/dashboard/professional/requests/[id]/quote/page.tsx`
- M `src/app/(dashboard)/dashboard/professional/requests/page.tsx`
- M `src/app/(dashboard)/dashboard/professional/self-billing/actions.ts`
- M `src/app/(dashboard)/dashboard/professional/self-billing/page.tsx`
- M `src/app/(dashboard)/dashboard/professional/status-badges.tsx`
- M `src/app/(dashboard)/dashboard/professional/verification/actions.ts`
- M `src/app/(dashboard)/dashboard/professional/verification/page.tsx`
- M `src/app/(dashboard)/disputes/[id]/dispute-message-form.tsx`
- M `src/app/(dashboard)/disputes/[id]/page.tsx`
- M `src/app/(dashboard)/disputes/actions.ts`
- M `src/app/(dashboard)/disputes/new/new-dispute-form.tsx`
- M `src/app/(dashboard)/disputes/new/page.tsx`
- M `src/app/(dashboard)/disputes/page.tsx`
- M `src/app/(dashboard)/jobs/[id]/job-actions.tsx`
- M `src/app/(dashboard)/jobs/[id]/page.tsx`
- M `src/app/(dashboard)/jobs/[id]/payment-actions.ts`
- M `src/app/(dashboard)/jobs/actions.ts`
- M `src/app/(dashboard)/jobs/job-status-badge.tsx`
- M `src/app/(dashboard)/jobs/page.tsx`
- M `src/app/(dashboard)/messages/[id]/message-bubble.tsx`
- M `src/app/(dashboard)/messages/[id]/message-composer.tsx`
- M `src/app/(dashboard)/messages/[id]/page.tsx`
- M `src/app/(dashboard)/messages/actions.ts`
- M `src/app/(dashboard)/messages/open-conversation-button.tsx`
- M `src/app/(dashboard)/messages/page.tsx`
- M `src/app/(dashboard)/notifications/actions.ts`
- M `src/app/(dashboard)/profile/actions.ts`
- M `src/app/(dashboard)/profile/avatar-upload.tsx`
- M `src/app/(dashboard)/profile/change-password-form.tsx`
- M `src/app/(dashboard)/profile/delete-account-dialog.tsx`
- M `src/app/(dashboard)/profile/edit-profile-form.tsx`
- M `src/app/(dashboard)/profile/page.tsx`
- M `src/app/(dashboard)/receipts/[id]/page.tsx`
- M `src/app/(dashboard)/receipts/page.tsx`
- M `src/app/(dashboard)/requests/[id]/cancel-service-request-dialog.tsx`
- M `src/app/(dashboard)/requests/[id]/edit/page.tsx`
- M `src/app/(dashboard)/requests/[id]/page.tsx`
- M `src/app/(dashboard)/requests/[id]/quotes/accept-quote-dialog.tsx`
- M `src/app/(dashboard)/requests/[id]/quotes/actions.ts`
- M `src/app/(dashboard)/requests/[id]/quotes/page.tsx`
- M `src/app/(dashboard)/requests/[id]/service-request-photo-manager.tsx`
- M `src/app/(dashboard)/requests/actions.ts`
- M `src/app/(dashboard)/requests/new/page.tsx`
- M `src/app/(dashboard)/requests/page.tsx`
- M `src/app/(dashboard)/requests/service-request-form.tsx`
- M `src/app/(dashboard)/reviews/actions.ts`
- M `src/app/(dashboard)/support-tickets/[id]/page.tsx`
- M `src/app/(dashboard)/support-tickets/actions.ts`
- M `src/app/(dashboard)/support-tickets/new-support-ticket-form.tsx`
- M `src/app/(dashboard)/support-tickets/page.tsx`
- M `src/app/(marketing)/_sections/category-grid.tsx`
- M `src/app/(marketing)/_sections/hero-search.tsx`
- M `src/app/(marketing)/_sections/hero.tsx`
- M `src/app/(marketing)/_sections/how-it-works.tsx`
- M `src/app/(marketing)/_sections/professional-cta.tsx`
- M `src/app/(marketing)/_sections/trust-section.tsx`
- M `src/app/(marketing)/companies/[id]/page.tsx`
- M `src/app/(marketing)/page.tsx`
- M `src/app/(marketing)/professionals/[id]/page.tsx`
- M `src/app/(marketing)/professionals/page.tsx`
- M `src/app/(marketing)/professionals/search-form.tsx`
- M `src/app/(marketing)/professionals/search-results-list.tsx`
- M `src/app/(marketing)/professionals/verification-badge.tsx`
- M `src/app/(marketing)/search/actions.ts`
- M `src/app/(marketing)/search/location-picker.tsx`
- M `src/app/(marketing)/search/page.tsx`
- M `src/app/(marketing)/search/results-list.tsx`
- M `src/app/(marketing)/search/search-form.tsx`
- M `src/app/(marketing)/servicios/[slug]/[location]/page.tsx`
- M `src/app/(marketing)/servicios/[slug]/page.tsx`
- M `src/app/(marketing)/servicios/page.tsx`
- M `src/app/(marketing)/ubicaciones/[slug]/page.tsx`
- M `src/app/(marketing)/ubicaciones/espana/page.tsx`
- M `src/app/(marketing)/ubicaciones/page.tsx`
- M `src/app/api/cron/expire-workflows/route.ts`
- M `src/app/api/cron/gdpr-cloudinary-purge/route.ts`
- M `src/app/api/cron/reconciliation-run/route.ts`
- M `src/app/api/cron/referral-affiliate-maintenance/route.ts`
- M `src/app/api/documents/company-verification/[documentId]/route.ts`
- M `src/app/api/documents/verification/[documentId]/route.ts`
- M `src/app/api/health/circuit-breakers/route.ts`
- M `src/app/api/health/diagnostics/route.ts`
- M `src/app/api/health/ready/route.ts`
- M `src/app/api/health/startup/route.ts`
- M `src/app/api/realtime/channels/route.ts`
- M `src/app/api/realtime/presence/[userId]/route.ts`
- M `src/app/api/realtime/sse/route.ts`
- M `src/app/api/user/language/route.ts`
- M `src/app/api/webhooks/persona/route.ts`
- M `src/app/api/webhooks/stripe-payments/route.ts`
- M `src/app/api/webhooks/stripe/route.ts`
- M `src/app/auth/actions.ts`
- M `src/app/auth/forgot-password/forgot-password-form.tsx`
- M `src/app/auth/forgot-password/page.tsx`
- M `src/app/auth/login/login-form.tsx`
- M `src/app/auth/login/page.tsx`
- M `src/app/auth/logout/logout-redirect.tsx`
- M `src/app/auth/logout/page.tsx`
- M `src/app/auth/register/page.tsx`
- M `src/app/auth/register/register-form.tsx`
- M `src/app/auth/reset-password/page.tsx`
- M `src/app/auth/reset-password/reset-password-form.tsx`
- M `src/app/auth/verify-email/page.tsx`
- M `src/app/error.tsx`
- M `src/app/layout.tsx`
- M `src/app/llms.txt/route.ts`
- M `src/app/loading.tsx`
- M `src/app/manifest.ts`
- M `src/app/not-found.tsx`
- M `src/app/opengraph-image.tsx`
- M `src/app/providers.tsx`
- M `src/app/robots.ts`
- M `src/app/sitemap.ts`
- M `src/core/application/dto/admin.dto.ts`
- M `src/core/application/dto/ai-visibility.dto.ts`
- M `src/core/application/dto/analytics.dto.ts`
- M `src/core/application/dto/auth.dto.ts`
- M `src/core/application/dto/booking.dto.ts`
- M `src/core/application/dto/chat.dto.ts`
- M `src/core/application/dto/company-invitation.dto.ts`
- M `src/core/application/dto/company-membership.dto.ts`
- M `src/core/application/dto/company-verification.dto.ts`
- M `src/core/application/dto/company.dto.ts`
- M `src/core/application/dto/discovery.dto.ts`
- M `src/core/application/dto/dispute.dto.ts`
- M `src/core/application/dto/feature-flag.dto.ts`
- M `src/core/application/dto/financial.dto.ts`
- M `src/core/application/dto/geolocation.dto.ts`
- M `src/core/application/dto/job.dto.ts`
- M `src/core/application/dto/notification.dto.ts`
- M `src/core/application/dto/onboarding.dto.ts`
- M `src/core/application/dto/portfolio.dto.ts`
- M `src/core/application/dto/professional.dto.ts`
- M `src/core/application/dto/profile.dto.ts`
- M `src/core/application/dto/quote.dto.ts`
- M `src/core/application/dto/referral.dto.ts`
- M `src/core/application/dto/review.dto.ts`
- M `src/core/application/dto/search-read-model.dto.ts`
- M `src/core/application/dto/search.dto.ts`
- M `src/core/application/dto/service-request.dto.ts`
- M `src/core/application/dto/support-ticket.dto.ts`
- M `src/core/application/dto/trust-integrity.dto.ts`
- M `src/core/application/dto/verification.dto.ts`
- M `src/core/application/use-cases/auth/compose.ts`
- M `src/core/application/use-cases/auth/register-user.use-case.ts`
- M `src/core/application/use-cases/auth/request-password-reset.use-case.ts`
- M `src/core/application/use-cases/notification/notify-company-membership-change.subscriber.ts`
- M `src/core/application/use-cases/workflow-expiration/expire-service-requests.use-case.ts`
- M `src/core/domain/repositories/service-request-repository.ts`
- M `src/core/infrastructure/database/prisma/repositories/prisma-service-request-repository.ts`
- M `src/core/infrastructure/i18n/message-catalog.ts`
- M `src/core/infrastructure/i18n/message-loader.ts`
- M `src/core/infrastructure/notifications/channels/email-notification-channel.ts`
- M `src/core/infrastructure/notifications/channels/realtime-notification-channel.ts`
- M `src/core/infrastructure/notifications/notification-dispatcher.compose.ts`
- M `src/core/infrastructure/sms/sms-message-catalog.ts`
- M `src/presentation/components/dashboard/admin-filter-form.tsx`
- M `src/presentation/components/dashboard/admin-table-pager.tsx`
- M `src/presentation/components/dashboard/appointment-timeline-steps.ts`
- M `src/presentation/components/dashboard/cards/appointment-card.tsx`
- M `src/presentation/components/dashboard/cards/company-card.tsx`
- M `src/presentation/components/dashboard/cards/job-card.tsx`
- M `src/presentation/components/dashboard/cards/quote-card.tsx`
- M `src/presentation/components/dashboard/cards/request-card.tsx`
- M `src/presentation/components/dashboard/dashboard-shell.tsx`
- M `src/presentation/components/dashboard/professional-profile-banner.tsx`
- M `src/presentation/components/dashboard/quote-items-table.tsx`
- M `src/presentation/components/dashboard/quote-timeline-steps.ts`
- M `src/presentation/components/dashboard/status-badge.tsx`
- M `src/presentation/components/dashboard/status-timeline.tsx`
- M `src/presentation/components/forms/field-badges.tsx`
- M `src/presentation/components/layout/section.tsx`
- M `src/presentation/components/maps/interactive-map.tsx`
- M `src/presentation/components/shared/site-footer.tsx`
- M `src/presentation/components/ui/breadcrumb.tsx`
- M `src/presentation/components/ui/button-variants.ts`
- M `src/presentation/components/ui/button.tsx`
- M `src/presentation/components/ui/card.tsx`
- M `src/presentation/components/ui/checkbox.tsx`
- M `src/presentation/components/ui/chip.tsx`
- M `src/presentation/components/ui/combobox.tsx`
- M `src/presentation/components/ui/confirm-dialog.tsx`
- M `src/presentation/components/ui/dialog.tsx`
- M `src/presentation/components/ui/drawer.tsx`
- M `src/presentation/components/ui/error-state.tsx`
- M `src/presentation/components/ui/input.tsx`
- M `src/presentation/components/ui/label.tsx`
- M `src/presentation/components/ui/loading-state.tsx`
- M `src/presentation/components/ui/pagination.tsx`
- M `src/presentation/components/ui/password-input.tsx`
- M `src/presentation/components/ui/popover.tsx`
- M `src/presentation/components/ui/progress.tsx`
- M `src/presentation/components/ui/search-input.tsx`
- M `src/presentation/components/ui/select.tsx`
- M `src/presentation/components/ui/separator.tsx`
- M `src/presentation/components/ui/spinner.tsx`
- M `src/presentation/components/ui/switch.tsx`
- M `src/presentation/components/ui/textarea.tsx`
- M `src/presentation/components/ui/toast.tsx`
- M `src/presentation/components/ui/typography.tsx`
- M `src/shared/content/ai-visibility-queries.ts`
- M `src/shared/content/locations.ts`
- M `src/shared/content/national-coverage.ts`
- M `src/shared/content/services.ts`
- M `src/shared/i18n/locales.ts`
- M `src/shared/i18n/validation-messages.ts`
- M `src/shared/seo/site.ts`
- M `src/shared/seo/structured-data.ts`
- M `src/shared/utils/build-dashboard-nav-groups.ts`
- M `src/shared/utils/format-appointment-window.ts`
- M `src/shared/utils/professional-profile-banner.ts`
- M `tests/integration/admin/change-user-role-server-action.test.ts`
- M `tests/unit/app/admin-reconciliation-actions.test.ts`
- M `tests/unit/app/professional-onboarding-actions.test.ts`
- M `tests/unit/app/quote-form.test.tsx`
- M `tests/unit/app/seo/location-page-metadata.test.ts`
- M `tests/unit/app/seo/national-coverage-metadata.test.ts`
- M `tests/unit/app/seo/root-layout-metadata.test.ts`
- M `tests/unit/app/seo/service-location-page-metadata.test.ts`
- M `tests/unit/app/seo/service-page-metadata.test.ts`
- M `tests/unit/core/application/use-cases/notification/notify-company-membership-change.subscriber.test.ts`
- M `tests/unit/core/infrastructure/i18n/messages-completeness.test.ts`
- M `tests/unit/presentation/appointment-timeline-steps.test.ts`
- M `tests/unit/presentation/chip.test.tsx`
- M `tests/unit/presentation/dashboard-shell-context.test.ts`
- M `tests/unit/presentation/dashboard-shell.test.tsx`
- M `tests/unit/presentation/dashboard-status-badge-wrappers.test.tsx`
- M `tests/unit/presentation/drawer.test.tsx`
- M `tests/unit/presentation/error-state.test.tsx`
- M `tests/unit/presentation/field-badges.test.tsx`
- M `tests/unit/presentation/language-switcher.test.tsx`
- M `tests/unit/presentation/loading-state.test.tsx`
- M `tests/unit/presentation/pagination.test.tsx`
- M `tests/unit/presentation/password-input.test.tsx`
- M `tests/unit/presentation/quote-items-table.test.tsx`
- M `tests/unit/presentation/quote-timeline-steps.test.ts`
- M `tests/unit/presentation/search-input.test.tsx`
- M `tests/unit/presentation/spinner.test.tsx`
- M `tests/unit/presentation/status-badge.test.tsx`
- M `tests/unit/shared/content/locations.test.ts`
- M `tests/unit/shared/content/national-coverage.test.ts`
- M `tests/unit/shared/content/services.test.ts`
- M `tests/unit/shared/i18n/locales.test.ts`
- M `tests/unit/shared/i18n/negotiate-locale.test.ts`
- M `tests/unit/shared/seo/site.test.ts`
- M `tests/unit/shared/seo/structured-data.test.ts`
- M `tests/unit/shared/utils/build-dashboard-nav-groups.test.ts`
- M `tests/unit/shared/utils/professional-profile-banner.test.ts`
- M `vitest.config.ts`
- new `.probe-prof/`
- new `MaestroYa_Module_120_Multilingual_Localization_Report.md`
- new `docs/MODULE_120_LOCALIZATION_CONVENTIONS.md`
- new `scripts/i18n-hardcoded-scan.cjs`
- new `scripts/i18n-missing-keys.mjs`
- new `src/app/(dashboard)/admin/_lib/`
- new `src/app/(dashboard)/admin/reconciliation/_components/format-duration.ts`
- new `src/app/(dashboard)/dashboard/professional/appointments/appointment-window.ts`
- new `src/app/(dashboard)/dashboard/professional/category-labels.ts`
- new `src/core/application/ports/auth-email-composer.ts`
- new `src/core/infrastructure/email/intl-auth-email-composer.ts`
- new `src/core/infrastructure/notifications/recipient-notification-localizer.ts`
- new `src/i18n/next-intl.d.ts`
- new `src/presentation/hooks/use-localized-errors.ts`
- new `src/presentation/i18n/`
- new `src/shared/i18n/notification-templates.ts`
- new `tests/test-utils/intl-setup.ts`
- new `tests/test-utils/intl.ts`
- new `tests/unit/app/marketing-auth-localization.test.tsx`
- new `tests/unit/core/infrastructure/email/`
- new `tests/unit/core/infrastructure/notifications/recipient-notification-localizer.test.ts`
- new `tests/unit/i18n/`
- new `tests/unit/presentation/admin-i18n.test.tsx`
- new `tests/unit/presentation/company-partner-i18n.test.tsx`
- new `tests/unit/presentation/customer-area-i18n.test.tsx`
- new `tests/unit/presentation/i18n/`
- new `tests/unit/shared/content/raw-catalog.ts`
- new `tests/unit/shared/i18n/notification-templates.test.ts`
- new `tests/unit/shared/i18n/validation-keys-coverage.test.ts`

(Plus every `src/i18n/messages/<locale>/*.json` file and the new `src/i18n/messages/<locale>/index.ts` for all 12 locales.)

## 17. Recommended manual testing checklist

Before starting: run `npx prisma generate`, then `npm run dev`. Use a private window for the guest checks.

1. On the home page, switch **Spanish → English**. The header, hero, sections and footer should all be English, with no Spanish or English mix.
2. Switch **English → Ukrainian**, **Ukrainian → Russian (Русский)**, then **Russian → Dutch (Nederlands)**, then **Dutch → Spanish**. Each switch should keep you on the same page and scroll position.
3. **Refresh** the page. The chosen language should persist.
4. **Navigate** to /servicios, /ubicaciones, /professionals and /search. The language should persist.
5. Open **login** and **register** in Russian and submit the empty form. The validation messages should be in Russian, and a wrong password should show the Russian "invalid credentials" text.
6. Submit an **invalid form** in the dashboard (for example, a new request with a missing title) in Dutch. The field errors and the toast should be in Dutch.
7. Trigger a **server error message** (for example, accept a quote twice). The message should be localized, not English.
8. Open a **service page** (/servicios/fontaneria) and a **location page** (/ubicaciones/…) in ru and nl. The content, FAQ and page `<title>` should be translated, and the canonical URL should be unchanged (view source).
9. Open a **professional profile** and a **company profile**. Category names should be localized, and names and reviews should appear as written by users.
10. Check the **dashboard** as customer, professional, company and partner: sidebar, KPIs, status badges, dates and amounts should follow the locale (€ formatting per locale).
11. Check **notifications** (for example, via an action that creates one). The title and message should be in the viewer's language.
12. Check the **mobile layout** (≈375px): open the mobile menu and the language list (12 entries). Long German, Russian and Dutch labels should wrap without overflow.
13. **Log out, then log in again** from another browser. The account's saved language should apply (stored `preferredLocale`).
14. Register in Dutch and check that the **verification e-mail** arrives in Dutch. Request a **password reset** and check that the e-mail uses the saved language.
15. As admin, check that the **/admin** pages appear in Spanish or English. Other locales should fall back to Spanish (expected).
16. Open an **invoice/receipt** page and check that the page chrome is translated, while the document block stays in Spanish with the "issued language" notice.
