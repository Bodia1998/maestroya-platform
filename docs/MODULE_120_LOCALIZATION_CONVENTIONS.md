# Module 120 — Localization conventions

The single guide for putting user-facing text into MaestroYa's message
catalog. It extends Module 29 (docs/MODULE_29_INTERNATIONALIZATION.md);
nothing here replaces that architecture (next-intl, no locale URL segment,
cookie + `User.preferredLocale`, Spanish default + per-key fallback).

## 1. Locales

`es` (default, source of truth), `en`, `uk`, `cs`, `de`, `fr`, `it`, `pt`,
`ro`, `pl`, `ru`, `nl` — `src/shared/i18n/locales.ts`.

Every key is written to `src/i18n/messages/es/<ns>.json` **first**, then to
all eleven other locales. No placeholders, no English (or Spanish) copied
into another locale, no "TODO". Exception: the `admin` namespace is
Spanish + English only (product decision, Module 120); other locales fall
back to Spanish there.

Check with:

```bash
node scripts/i18n-missing-keys.mjs <namespace>   # key parity + ICU argument parity
node scripts/i18n-hardcoded-scan.cjs <paths…>    # leftover hardcoded strings
npx vitest run tests/unit/core/infrastructure/i18n
npx tsc --noEmit                                  # t("key") is type-checked against es
```

## 2. Namespaces (one JSON file per locale each)

| Namespace | Scope |
| --- | --- |
| `common` | generic actions, states, labels, pagination, generic errors |
| `nav` | header, mobile menu, user menu |
| `auth` | login, register, logout, verify email, forgot/reset password |
| `validation` | every validation message, incl. DTO-specific `dto.*` keys |
| `errors` | user-facing error text: `byCode.*`, `domain.*` (see §6) |
| `enums` | labels for enum values shared across areas (`enums.status.*`) |
| `ui` | shared presentation components (`src/presentation/components/**`) |
| `marketing` | home page, public search, professional/company public pages, footer, 404/error |
| `services` | category names (`services.categories.<slug>`), service/location page chrome |
| `knowledge` | Module 118 editorial service/location content (server-only) |
| `seo` | page titles/descriptions, OG text (server-only) |
| `dashboard` | dashboard shell and overview page |
| `customer` | customer area: requests, quotes (customer side), appointments, messages, disputes, receipts, reviews, support tickets |
| `jobs` | jobs (customer side) and shared job/request/quote vocabulary |
| `profile`, `settings` | profile & settings pages |
| `notifications` | notification centre UI |
| `notificationTemplates` | localized rendering of stored notifications by `type` |
| `professional` | everything under `/dashboard/professional/**` |
| `company` | everything under `/dashboard/company/**` |
| `partner` | affiliate/partner area `/dashboard/partner/**` |
| `admin` | admin panel (es + en only) |
| `emails` | transactional email subjects/bodies (server-only) |

`emails`, `seo`, `knowledge` are **server-only**: they are never shipped to
the browser (`selectClientMessages`), so only Server Components / server
code may read them. `admin` is only shipped to admins.

Keys: nested camelCase, grouped by page/component
(`professional.quotes.form.submit`). Enum-valued keys use the raw enum
value (`enums.status.IN_PROGRESS`).

## 3. Reading messages

- Async Server Component / `generateMetadata` / Server Action:
  `const t = await getTranslations("professional");`
- Sync Server Component or Client Component: `const t = useTranslations("professional");`
- Dates/numbers/currency: `getFormatter()` / `useFormatter()` from next-intl
  (`format.dateTime(d, { dateStyle: "medium" })`,
  `format.number(n, { style: "currency", currency: "EUR" })`), or the
  existing `formatCurrencyFromMinorUnits(locale, …)` helper. Never
  `toLocaleString()` without the active locale, never hardcoded `"es-ES"`
  for UI text.
- Plurals/variables: ICU in the message (`{count, plural, one {# job} other {# jobs}}`).
  Never concatenate sentence fragments or build plurals in code
  (`${n} user${n === 1 ? "" : "s"}` is forbidden). Russian, Ukrainian,
  Polish and Czech need `one/few/many/other`; Romanian `one/few/other`.
- Rich text: `t.rich("key", { link: (chunks) => <Link …>{chunks}</Link> })`.
- `t()` keys are type-checked against the Spanish catalog
  (`src/i18n/next-intl.d.ts`). For a dynamic key use a typed map, or
  `t(key as never)` guarded by `t.has(key as never)` with a fallback.

## 4. Forms and validation

- Client forms: `resolver: useLocalizedZodResolver(schema)` from
  `@/hooks/use-localized-errors` instead of `zodResolver(schema)`.
- Server Actions: `await localizeZodError(parsed.error)` /
  `await localizeZodFieldErrors(parsed.error)` from `@/presentation/i18n/server`
  instead of `parsed.error.issues[0]?.message ?? "…"`.
- DTO messages (`src/core/application/dto/**`) carry **keys, not prose**:
  a generic key from `VALIDATION_KEYS` (`"required"`) or a dotted key in
  the `validation` namespace (`"dto.quote.itemsRequired"`). Don't put
  `{placeholders}` in `dto.*` messages (the issue's values are not
  available for custom keys) — write the number into the sentence.

## 5. Errors from use cases

Server Actions:

```ts
} catch (error) {
  const t = await getTranslations("professional");
  return { success: false, error: await localizeActionError(error, t("quotes.sendFailed")) };
}
```

Client components: `const localize = useErrorLocalizer(); localize(error, t("…"))`.
Server Components showing a caught error: `localizeError(await getTranslations("errors") as never, error)`.

Never render `error.message` of a caught error directly.

## 6. Domain error messages

Domain/application errors keep their English developer messages (logs,
Sentry, audit trail). What the user sees is resolved at the edge by
`localizeError` (`src/presentation/i18n/error-messages.ts`):
exact static message → `errors.domain.<key>` via
`DOMAIN_ERROR_MESSAGE_KEYS`, else `errors.byCode.<CODE>`, else the
caller's localized fallback / `errors.generic`.

## 7. What is NOT translated

User-generated content (request titles/descriptions, chat and dispute
messages, reviews, portfolio text, company/professional names, uploaded
documents), people's names, e-mail addresses, brand names (MaestroYa,
Stripe, Persona), city/province names (proper nouns), IDs/references.

## 8. Legal and financial documents

Invoice, credit-note, self-billing and receipt **documents** keep the
legally significant wording they were issued with (Spanish): document
titles such as "Factura", the self-billing mention, tax line names (IVA,
IRPF), legal notices. Only the surrounding UI chrome (page title,
buttons, table headers that are not part of the document, help text) is
localized. Wrap a rendered legal document body in `lang="es"` and show
`ui.legalDocument.issuedLanguageNotice` ("This document is shown in the
language it was issued in"). Do not write new legal claims in any
language; list any text you believe needs legal review in the Module 120
report notes instead of inventing wording.

## 9. Terminology glossary

Use these terms consistently (singular; inflect naturally).

| en | es | uk | ru | nl | cs | de | fr | it | pt | ro | pl |
|---|---|---|---|---|---|---|---|---|---|---|---|
| customer | cliente | клієнт | клиент | klant | zákazník | Kunde | client | cliente | cliente | client | klient |
| professional | profesional | фахівець | специалист | vakman (pl. vakmensen) | profesionál | Fachkraft (pl. Fachleute) | professionnel | professionista | profissional | profesionist | specjalista |
| company | empresa | компанія | компания | bedrijf | firma | Unternehmen | entreprise | azienda | empresa | companie | firma |
| service request | solicitud | заявка | заявка | aanvraag | poptávka | Anfrage | demande | richiesta | pedido | cerere | zapytanie |
| quote | presupuesto | пропозиція | смета | offerte | nabídka | Angebot | devis | preventivo | orçamento | ofertă | wycena |
| job | trabajo | робота | заказ | opdracht | zakázka | Auftrag | mission | lavoro | trabalho | lucrare | zlecenie |
| appointment | cita | зустріч | визит | afspraak | schůzka | Termin | rendez-vous | appuntamento | marcação | programare | wizyta |
| service | servicio | послуга | услуга | dienst | služba | Dienstleistung | service | servizio | serviço | serviciu | usługa |
| verification | verificación | верифікація | верификация | verificatie | ověření | Verifizierung | vérification | verifica | verificação | verificare | weryfikacja |
| payment | pago | оплата | оплата | betaling | platba | Zahlung | paiement | pagamento | pagamento | plată | płatność |
| payout | cobro | виплата | выплата | uitbetaling | výplata | Auszahlung | versement | accredito | transferência | plată către profesionist | wypłata |
| commission | comisión | комісія | комиссия | commissie | provize | Provision | commission | commissione | comissão | comision | prowizja |
| affiliate | afiliado | партнер-афіліат | партнёр | affiliate-partner | affiliate partner | Affiliate-Partner | affilié | affiliato | afiliado | afiliat | partner afiliacyjny |
| referral | recomendación | рекомендація | рекомендация | doorverwijzing | doporučení | Empfehlung | parrainage | segnalazione | indicação | recomandare | polecenie |
| review | reseña | відгук | отзыв | beoordeling | recenze | Bewertung | avis | recensione | avaliação | recenzie | opinia |
| dispute | disputa | спір | спор | geschil | spor | Streitfall | litige | controversia | disputa | dispută | spór |
| invoice | factura | рахунок | счёт | factuur | faktura | Rechnung | facture | fattura | fatura | factură | faktura |
| receipt | recibo | квитанція | квитанция | ontvangstbewijs | potvrzení o platbě | Beleg | reçu | ricevuta | recibo | chitanță | potwierdzenie płatności |
| materials | materiales | матеріали | материалы | materialen | materiál | Material | matériaux | materiali | materiais | materiale | materiały |
| location | ubicación | локація | регион | locatie | lokalita | Standort | emplacement | località | localização | locație | lokalizacja |
| self-billing | autofacturación | самовиставлення рахунків | самовыставление счетов | self-billing (zelffacturering) | samofakturace | Gutschriftverfahren | autofacturation | autofatturazione | autofaturação | autofacturare | samofakturowanie |
| dashboard | panel | панель | панель | dashboard | přehled | Dashboard | tableau de bord | pannello | painel | panou | panel |

Register (keep what existing files use): es *tú*, uk/ru *ви/вы*, nl *je*,
cs *vy*, de *du*, fr *vous*, it *tu*, pt (European) *você* avoided — use
the impersonal/"o seu" style, ro *tu*, pl *ty* (imperative "Zaloguj się").
