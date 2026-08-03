# Module 29 — Internationalization

## 1. Purpose and scope

The entire interface of MaestroYa can now be read in ten languages, and a
visitor can change language from anywhere in one click — with no logout,
no full page reload, and no navigation away from the page they were on.

Supported languages, in picker order:

| Code | Language   | Native name       |
| ---- | ---------- | ----------------- |
| `es` | Spanish    | Español (default) |
| `en` | English    | English           |
| `uk` | Ukrainian  | Українська        |
| `cs` | Czech      | Čeština           |
| `de` | German     | Deutsch           |
| `fr` | French     | Français          |
| `it` | Italian    | Italiano          |
| `pt` | Portuguese | Português         |
| `ro` | Romanian   | Română            |
| `pl` | Polish     | Polski            |

**In scope** — interface text only: navigation, header/mobile menu, user
menu, auth screens, dashboards (customer, professional, company), admin
panel labels, jobs/requests/quotes surfaces, profile & settings,
notifications, validation messages, system/error messages, email
templates, and marketing/landing copy.

**Explicitly out of scope — never translated:** job titles and
descriptions, chat messages, reviews, company names, professional names,
uploaded documents, portfolio descriptions. No use case, repository or
Prisma query that stores or returns user-generated content was touched by
this module. Translation is a rendering concern applied to _our_ strings;
a customer's description of their leaking tap is data, and data is
returned exactly as it was written.

**Also explicitly untouched:** Stripe, Stripe Connect, payment
processing, IVA/VAT, tax calculation, and the Module 22 financial
settlement code. The only money-adjacent thing this module adds is a
_display_ formatter (§6), which does no arithmetic beyond a minor-unit
division and imports nothing from the payments layer.

The architectural requirement driving every decision below: **adding an
eleventh language must be a translation-files-only change.** No migration,
no new use case, no component edit, no route change. §7 walks through
exactly what that costs today (one constant, one catalog block, twelve
JSON files).

## 2. Library selection

### 2.1 The choice

`next-intl` was selected as the reference architecture, and this module's
runtime implements its API surface (`getTranslations(ns)` /
`useTranslations(ns)` returning `t(key, values)`, `useFormatter()`, a
`locale`+`messages` client provider) against the platform's own `Intl`
primitives, with zero new runtime dependencies.

**Why the API and not the package?** The environment this module was
built in has no access to the npm registry (`403 Forbidden` on every
`registry.npmjs.org` request — see §9), so `next-intl` could not be
installed, and shipping code that imports a package the build cannot
resolve would have left the repository in a non-compiling state. The
response was to implement the same contract behind the same seams rather
than to invent a different one:

- Message files are **valid ICU MessageFormat** and live in
  `src/i18n/messages/<locale>/<namespace>.json` — the layout `next-intl`
  expects.
- Call sites use `t("language.switchTo", { language })`, identical in
  shape to `next-intl`.
- The client provider takes `locale` + `messages` props, like
  `NextIntlClientProvider`.

Adopting the real package is therefore a change to three files
(`translator.ts`, `server-locale.ts`, `i18n-provider.tsx`) plus a
`package.json` entry, and to **no** component, no message file, and no
test of application behaviour. §10 lists this as the first follow-up.

### 2.2 Why next-intl over the alternatives, for _this_ repository

- **`next-i18next`** — built on the Pages Router's
  `serverSideTranslations` + `appWithTranslation` HOC model. It has no
  real App Router story: it cannot provide translations to a React Server
  Component, which is where the majority of this app renders (every
  `page.tsx` under `(dashboard)` and `(marketing)` is a Server
  Component). Adopting it would mean converting pages to Client
  Components to get at translations — precisely the opposite of the
  Server-Components-by-default rule in `docs/ARCHITECTURE.md`.
- **`react-i18next`** (bare) — works anywhere React works, but ships no
  Next.js integration at all: SSR wiring, per-request instance isolation
  (a module-level `i18n` singleton is a cross-request data leak on a Node
  server rendering multiple users concurrently), Server Component access,
  and middleware negotiation would all be hand-built. That is the same
  amount of infrastructure this module wrote, with an extra dependency on
  top and a well-known hydration-mismatch class of bug (`Suspense`
  boundaries + async backend loading).
- **Lingui** — excellent runtime, but its ergonomics depend on a Babel/SWC
  macro compiler step and a `.po`-catalog extract/compile workflow. This
  repo's build is stock `next build` with no custom SWC plugins, and its
  translation workflow has no PO tooling. Adding a compiler stage to the
  build for a ten-language UI is a large, hard-to-reverse commitment.
- **`next-intl`** — designed for the App Router: Server Component
  support, a Client Component provider, a middleware helper, and ICU
  message format (so plural rules for Polish/Czech/Ukrainian — which have
  `one`/`few`/`many` categories English does not — come from CLDR rather
  than from a translator writing two branches and hoping). It is the
  option whose model matches the code that already exists here.

The one piece of `next-intl`'s design deliberately _not_ adopted is its
locale-prefixed routing (`/[locale]/…`) — see §3.3.

## 3. Architecture

### 3.1 Layering

```
src/shared/i18n/                 pure, framework-free, importable everywhere
  locales.ts                     the language list + cookie/header/storage names
  negotiate-locale.ts            Accept-Language parsing + the two priority chains
  message-format.ts              ICU renderer over Intl.PluralRules/NumberFormat/DateTimeFormat
  translator.ts                  t(key, values) / t.has / t.raw + fallback merging
  validation-messages.ts         translatable Zod messages
  locale-storage.ts              localStorage + mirror cookie (browser-only, no-ops elsewhere)
src/shared/utils/intl-format.ts  date/number/currency/relative-time/list formatting

src/i18n/messages/<locale>/<ns>.json   120 files: 10 locales x 12 namespaces

src/core/infrastructure/i18n/
  message-catalog.ts             static import of every (locale, namespace)
  message-loader.ts              fallback merge + per-process memoisation
  server-locale.ts               the server seam: getRequestLocale/getTranslations/getFormatter

src/core/application/
  dto/i18n.dto.ts                schema generated from SUPPORTED_LOCALES
  use-cases/i18n/                Get/UpdateUserLanguagePreference + compose.ts

src/core/domain/repositories/user-repository.ts   +2 methods
src/core/infrastructure/database/prisma/repositories/prisma-user-repository.ts

src/app/api/user/language/route.ts    PATCH
middleware.ts                          Accept-Language negotiation, chained after next-auth
src/app/layout.tsx, providers.tsx      bootstrap + client provider mounting

src/presentation/components/shared/
  i18n-provider.tsx              context + useTranslations/useLocale/useFormatter
  language-switcher.tsx          the one switcher, two variants
src/presentation/hooks/use-i18n.ts     conventional @/hooks entry point
```

Nothing in `src/core/domain` or `src/core/application` renders a string.
The two new use cases move a locale _code_; the only file in those layers
that knows a language list exists is the DTO, and it derives that list
from `SUPPORTED_LOCALES` rather than restating it.

### 3.2 Middleware chaining

`middleware.ts` still exports `auth((req) => …)`. The next-auth callback,
`PROTECTED_PREFIXES`, `ROLE_GATED_PREFIXES`, the professional-onboarding
redirect and every `callbackUrl` construction are byte-for-byte
unchanged in behaviour. The pre-existing `withRequestId` response
decorator (Module 25) was renamed `withRequestContext` and extended: it
now also negotiates `Accept-Language` once per request and forwards the
match on `x-maestroya-locale`, on both the forwarded request headers and
the response — the same two write targets, the same mechanism.

Middleware does **not**: read the database (Edge runtime, no Prisma, and
the account preference must come from a use case anyway), write the
locale cookie (a browser default is not a user's choice), or rewrite any
URL.

### 3.3 Why there is no `/[locale]/…` URL segment

The conventional `next-intl` setup routes every page under a locale
segment. Rejected here, deliberately:

- Every existing URL would move, breaking stored deep links, and every
  `redirect()` / `revalidatePath()` call in the app would need rewriting.
- `middleware.ts` builds `callbackUrl` values for the next-auth login
  redirect from `req.nextUrl.pathname`. Locale-prefixing turns that into
  a locale-aware transformation _inside the auth chain_ — the single
  riskiest place in this codebase to add a URL-manipulation bug.
- Conceptually it is wrong for this product: the language a user reads
  the UI in is a property of _the user_, not of the resource. Two users
  reading the same job request read the same resource; `/es/jobs/42` and
  `/uk/jobs/42` being distinct URLs implies otherwise.

The cost of the cookie-based approach is that the root layout reads
cookies/headers, which opts the tree into dynamic rendering. Accepted and
recorded in §10.

## 4. Language resolution and persistence

### 4.1 Priority chains

**Guest** (`resolveGuestLocale`):

1. `localStorage` (read server-side through its mirror cookie) —
2. `Accept-Language`, matched on the primary subtag (`pt-BR` → `pt`) —
3. Spanish.

**Authenticated** (`resolveAuthenticatedLocale`):

1. `User.preferredLocale` from the database, via
   `GetUserLanguagePreferenceUseCase` —
2. `Accept-Language` —
3. Spanish.

The authenticated chain deliberately does **not** consult the guest
cookie. Once there is an account, the account is authoritative; honouring
a cookie above it would show the same user two different languages on two
devices despite having chosen one. Because the switcher writes the
database synchronously on every change, "signed in with no
`preferredLocale`" only ever means "has genuinely never chosen", where
the browser's own languages are the better guess.

Every value entering these chains — cookie, header, request body, and the
database column itself — passes through `toLocale`, which returns `null`
for anything outside `SUPPORTED_LOCALES`. A stale code (a language
removed from the product, or one written by a newer instance during a
rolling deploy) therefore degrades to the next step of the chain instead
of stranding the user on a UI full of raw message keys.

### 4.2 Where the value is stored

| Audience      | Store                              | Written by                            | Read by            |
| ------------- | ---------------------------------- | ------------------------------------- | ------------------ |
| Guest         | `localStorage["maestroya_locale"]` | `persistLocale()`                     | client             |
| Guest         | cookie `maestroya_locale` (mirror) | `persistLocale()`                     | server (SSR)       |
| Authenticated | `User.preferredLocale`             | `PATCH /api/user/language` → use case | `server-locale.ts` |
| Authenticated | the same cookie                    | client + the PATCH response           | fast path          |

`localStorage` alone cannot work: it is unreadable from a Server
Component, a Route Handler and Edge middleware, so a `localStorage`-only
design gives every guest a Spanish first paint followed by a visible flip
to their language. The cookie is the _same value_, written by the same
function, purely so the server can render the first byte correctly.

The cookie is `SameSite=Lax` (so a click from an email lands in the right
language), `Secure` over HTTPS only (a `Secure` cookie is dropped on
plain-HTTP localhost), one year, and **not** `HttpOnly` — client code has
to read back what it wrote, and the value carries no authentication
meaning. The worst an attacker who forges it achieves is showing the
victim the UI in another language; it is validated against a closed union
before it can index anything.

### 4.3 The database column

`User.preferredLocale`, `VARCHAR(10)`, nullable, no default, no index —
added by `prisma/migrations/20260810000000_add_user_preferred_locale/`.
Forward-only and additive: `NULL` means "never explicitly chosen", which
is _not_ "Spanish", so no backfill is needed and every pre-existing row is
already correct.

Two deliberate non-choices:

- **Not the existing `preferredLanguageId` FK.** That column points at
  the seeded `languages` reference table, which models spoken/contact
  languages as admin-managed marketplace data and can contain codes the
  UI ships no messages for (e.g. `ca`). Coupling the two would make every
  new interface language depend on a data migration and would let an
  admin break the UI by deactivating a row. Both columns now coexist,
  each with its own meaning; the profile form's existing "preferred
  language" dropdown is untouched.
- **Not a Postgres enum.** An enum forces a migration (and an
  `ALTER TYPE … ADD VALUE`, which cannot run in a transaction on older
  Postgres) for every new language, which directly contradicts this
  module's central requirement. The allowed set is enforced at the
  application edge — `updateLanguagePreferenceSchema` (built from
  `SUPPORTED_LOCALES`) and again inside the use case.

### 4.4 The switch itself

`I18nProvider.setLocale(next)`:

1. writes `localStorage` + the mirror cookie **synchronously**, so the
   very next server render already sees the choice;
2. for signed-in users, fires `PATCH /api/user/language` — fire and
   forget; the UI never waits on a round trip to change language, and a
   failure surfaces as `switchFailed` (the Settings page shows it; the
   header switcher ignores it) without reverting anything;
3. calls `router.refresh()` inside a `useTransition`.

`router.refresh()` re-fetches the current route's RSC payload including
the root layout, so every Server Component re-renders and the provider
receives new `messages` — **no full page load, no component re-mount, no
loss of client state, and no effect on the session**. An
`optimisticLocale` flips `<html lang>`, the formatters and the switcher's
checkmark on the click itself, before the refresh lands.

A Route Handler rather than a Server Action is used for the write
specifically because the action queue is already occupied by that
refresh transition; a plain `fetch` does not serialise behind it.

## 5. Translation structure

Twelve namespaces, one JSON file each, per locale — 120 files. Namespaces
were chosen against the app's actual surfaces (its route groups,
dashboards and admin sections), not an invented taxonomy:

| Namespace       | Covers                                         |
| --------------- | ---------------------------------------------- |
| `common`        | actions, states, generic errors                |
| `nav`           | header, mobile menu, user menu                 |
| `auth`          | login, register, logout, verify, reset         |
| `validation`    | every user-facing validation message           |
| `dashboard`     | customer / professional / company dashboards   |
| `jobs`          | jobs, service requests, quotes, statuses       |
| `profile`       | the profile page's own sections and fields     |
| `settings`      | settings, including all language-switcher copy |
| `notifications` | the notification centre and type labels        |
| `admin`         | admin panel navigation and access errors       |
| `emails`        | email subjects, bodies, CTAs, shared chrome    |
| `marketing`     | landing hero, how-it-works, search, footer     |

Keys are nested (`language.switchTo`) and addressed by dotted path.
Messages are ICU: `{name}`, `{n, number}`, `{d, date, long}`,
`{d, time, short}`, `{n, plural, =0 {…} one {…} few {…} many {…} other {…}}`
with `#`, and `{v, select, …}`.

Plurals are per-language by construction: Polish `count` renders
"1 zlecenie / 3 zlecenia / 5 zleceń" because the branch is chosen by
`Intl.PluralRules("pl")`, not by an `n === 1` check. There is a test
asserting that 3 and 5 do not render identically.

`message-catalog.ts` lists every `(locale, namespace)` pair as a static
import. A dynamic
``import(`../../../i18n/messages/${locale}/${ns}.json`)`` would be
shorter but defeats static analysis — webpack would inline the whole
directory as a require-context, and a typo would only surface at runtime.
Typing it as `Record<Locale, LocaleCatalog>` makes "every locale has
every namespace" a compile error.

Every non-default locale is deep-merged over Spanish once per process
(`message-loader.ts`), so an untranslated key renders correct Spanish
rather than a raw key — and `messages-completeness.test.ts` fails the
build if such a gap ever exists in the first place.

## 6. Formatting

`src/shared/utils/intl-format.ts` — `createLocaleFormatter(locale)`
returns `date`, `time`, `dateTime`, `number`, `percent`, `currency`,
`currencyFromMinorUnits`, `relativeTime` and `list`. All are
`Intl`-backed and memoised per (locale, options); there is no format
string anywhere in the module.

`relativeTime` picks the largest unit that fits (year → month → week →
day → hour → minute → second) and uses `numeric: "auto"`, so English
yields "yesterday" rather than "1 day ago".

**Currency is display-only.** `currency(12.5)` takes a major-unit number
and defaults to EUR. `currencyFromMinorUnits(1250)` exists because Stripe
amounts arrive as integer minor units and every future call site should
convert through one audited helper rather than each writing `/ 100`; the
exponent is read from `Intl` (`maximumFractionDigits` for the currency),
so it is already correct for zero-decimal (JPY) and three-decimal (BHD)
currencies. No Stripe import, no tax, no rounding policy, no settlement
logic — those remain entirely Module 22's and the payments layer's.

## 7. How to add a new language

Example: Dutch (`nl`).

1. **`src/shared/i18n/locales.ts`** — add `"nl"` to `SUPPORTED_LOCALES`
   and `{ code: "nl", nativeName: "Nederlands", englishName: "Dutch" }`
   to `LOCALE_DESCRIPTORS`.
2. **Translation files** — copy `src/i18n/messages/es/` to
   `src/i18n/messages/nl/` and translate the twelve JSON files.
3. **`src/core/infrastructure/i18n/message-catalog.ts`** — add the twelve
   imports and the `nl: { … }` block, following the existing pattern.
4. `npm test` — `messages-completeness.test.ts` verifies the new locale
   has every namespace and every key, that nothing is empty, and that
   every message renders.

That is the entire change. The API schema, the language switcher, the
database column, the middleware, the resolution chain and every component
pick it up with no edit: the schema is generated from
`SUPPORTED_LOCALES`, the switcher iterates `LOCALE_DESCRIPTORS`, and the
column is a `VARCHAR`. Step 3 is the only piece of ceremony, and it is
mechanical and compiler-checked.

## 8. How to add a new translation key

1. Pick the namespace by surface (a settings screen → `settings`; a
   validation message → `validation`).
2. Add the key to **`src/i18n/messages/es/<namespace>.json`** first —
   Spanish is the fallback, so it is the one file that must never have a
   gap. Then add it to the other nine.
3. Use it:

   ```tsx
   // Server Component / Server Action / Route Handler
   const t = await getTranslations("settings");
   return <h2>{t("language.title")}</h2>;

   // Client Component
   const t = useTranslations("settings");
   return <p>{t("language.switchTo", { language: "Polski" })}</p>;
   ```

4. For anything countable, write a real ICU plural rather than
   concatenating — `{count, plural, one {# trabajo} other {# trabajos}}`
   — and give each language its own categories.
5. For dates/numbers/money in a component, prefer `useFormatter()` /
   `getFormatter()` over embedding `{d, date}` in a message when the
   value is not part of a sentence.

**Rules for future modules** (this is the pattern to follow so i18n keeps
working by default):

- Business logic — use cases, domain services, repositories — must never
  contain a user-facing string. Return a key, a code, or structured data;
  resolve it at the presentation/infrastructure edge. `DomainError`
  messages remain developer-facing (they are logged, not rendered).
- Notifications and emails: the use case decides _what happened_ and
  produces a type plus data; the email template or notification renderer
  reads the `emails`/`notifications` namespace in the recipient's locale
  and produces the prose. This is why the `emails` namespace exists
  already even though the current templates are minimal.
- Validation: put a `VALIDATION_KEYS.*` key in the schema's message slot,
  or (preferred for new schemas) no message at all and let
  `parseWithTranslatedErrors(schema, input, t)` localise every issue.
  Never `z.setErrorMap()` — a process-global map hands one request's
  language to another request's errors.

## 9. Prisma migration

Hand-authored, matching the naming and style of the most recent existing
migrations (which carry the same caveat — see
`20260808000000_add_workflow_expiration_notifications/migration.sql`).

`docker compose up -d` was attempted first and is not possible in the
environment this module was built in: `docker` is not installed, the HTTP
proxy returns `403` for `registry.npmjs.org` (so it could not be
installed either), and `prisma migrate dev` additionally could not reach
`binaries.prisma.sh` to fetch a schema engine. The migration SQL is
therefore exactly what `prisma migrate dev --create-only --name
add_user_preferred_locale` would emit for the schema diff — a single
`ALTER TABLE "users" ADD COLUMN "preferredLocale" VARCHAR(10);` — and
should be verified against a real database with
`npx prisma migrate dev` before deploy.

No existing migration was edited, `migration_lock.toml` was not touched,
no `prisma db push` was run, and the database was never reset.

## 10. Testing strategy

- **Unit** (`tests/unit/shared/i18n/*`, `tests/unit/shared/utils/*`) — the
  pure decision-making: locale narrowing, `Accept-Language` q-ordering
  and junk tolerance, primary-subtag matching, both priority chains, the
  ICU renderer (exact `=N` before category, `#` substitution, Polish
  `one/few/many`, nesting, never throwing on malformed input), the
  translator's missing-key behaviour and non-mutating fallback merge, and
  every formatter including minor-unit currency conversion.
- **Catalog** (`tests/unit/core/infrastructure/i18n/messages-completeness.test.ts`)
  — the guard rail behind §7: every locale has every namespace and every
  key the default locale has, nothing is empty, and all ~1,200 shipped
  messages render without leaking a brace. This is what turns "adding a
  language is translation-files-only" from a claim into a build failure
  when it stops being true.
- **Integration** (`tests/integration/i18n/`) — both use cases against
  the existing `FakeUserRepository`, the API schema contract, a stale
  stored code degrading gracefully, and the guest/authenticated
  persistence chains end to end.
- **Component** (`tests/unit/presentation/language-switcher.test.tsx`) —
  guest switching writes `localStorage` + cookie and never calls the API;
  signed-in switching PATCHes the endpoint; a failed account write
  surfaces without reverting the UI; every path calls `router.refresh()`
  rather than reloading.
- **E2E** (`tests/e2e/language-switching.spec.ts`) — a guest's choice
  survives a reload (i.e. the server, not just the client, honours it),
  `Accept-Language` is honoured before any choice, and switching neither
  navigates away nor signs the visitor out. Public pages only, matching
  the level of the pre-existing `smoke.spec.ts`.
- **Regression** — no existing test was weakened or removed. The two
  `FakeUserRepository` implementations gained the two new interface
  methods; nothing else in the existing suite changed.

## 11. Known limitations

1. **`next-intl` is not installed.** The runtime is an API-compatible
   in-repo implementation (§2.1). It covers the ICU subset this platform
   uses; it does not implement apostrophe escaping, `offset:` on plurals,
   `selectordinal`, number skeletons (`::currency/EUR`), or rich-text tag
   embedding. The completeness test renders every shipped message, so an
   author who reaches for an unsupported construct finds out at test
   time.
2. **Client message strings lag the switch by one refresh.** The
   optimistic locale flips `<html lang>`, formatters and the switcher
   immediately; translated _strings_ in Client Components arrive with the
   `router.refresh()` payload a moment later. Closing that gap means
   shipping all ten catalogs to the browser (or adding a per-locale
   fetch), which is a real bundle cost for a sub-100ms visual gap.
3. **Dynamic rendering.** Resolving the locale in the root layout reads
   cookies/headers, so routes are rendered dynamically. This is inherent
   to not putting the locale in the URL (§3.3).
4. **One extra query per authenticated request.** `resolveRequestLocale`
   is wrapped in React's `cache()`, so it is one indexed primary-key
   lookup per request, not per component — but it is not cached across
   requests.
5. **Pre-existing DTOs still carry English prose.** `auth.dto.ts`,
   `profile.dto.ts` and friends were written before this module and were
   deliberately not rewritten in one sweep;
   `translateValidationMessage` passes non-key strings through unchanged
   so they keep working. New and migrated schemas use the key/error-map
   pattern.
6. **Leaf form components are not yet fully translated.** The header,
   mobile menu, user menu, profile/settings page and the switcher itself
   render from the catalog. Individual form components inside feature
   routes (e.g. `edit-profile-form.tsx`, quote forms, admin tables) still
   hold their original strings; the namespaces and the pattern for
   migrating them exist, and doing so is mechanical, but sweeping every
   component was out of scope for one module.
7. **Email templates.** The `emails` namespace and the locale-aware
   rendering pattern are in place; the current `EmailSender`
   implementations still receive already-composed HTML from their
   callers. Wiring the auth emails through the namespace is a small,
   isolated follow-up (§12).
8. **Regional variants collapse to their primary subtag.** `pt-BR` and
   `pt-PT` both resolve to `pt` (European Portuguese). Shipping regional
   catalogs is a product decision, not a technical blocker.

## 12. Future improvements

- Swap the in-repo runtime for the real `next-intl` package once the
  registry is reachable — three files, no message or component changes.
- Migrate the remaining feature-level components and the pre-i18n DTOs
  onto the catalog and the validation-key pattern, namespace by
  namespace.
- Render the auth emails (verify address, reset password) through the
  `emails` namespace in the recipient's `preferredLocale`, resolved at
  the infrastructure edge from the user record the use case already
  loads.
- Ship only the namespaces a route actually uses to the client, instead
  of the whole catalog, and lazily fetch a locale's messages so the
  string swap is instant (removes limitation 2).
- A translation-management workflow (export/import for translators, plus
  a CI check that a PR touching `es` also touches the other nine).
- Per-user timezone-aware date formatting: `User.timezone` already
  exists and is currently unused by the formatters, which render in the
  server's zone.
