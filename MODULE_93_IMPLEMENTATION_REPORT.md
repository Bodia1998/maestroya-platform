# Module 93 — Real Fraud & Trust Signal Providers

## 1. Initial architecture

Module 65 ("Trust & Integrity System") had already built the full scaffold this module needed:

- **Ports** (`src/core/application/ports/`): `DeviceFingerprintProvider`, `VpnProxyDetectionProvider`, `PhoneReputationProvider` — each a clean, vendor-neutral interface, documented as "architecture only — no external SDK integrated."
- **Null implementations** (`src/core/infrastructure/trust-integrity/null-*-provider.ts`): safe, always-available defaults that never throw and never treat "no signal" as fraud.
- **A single factory** (`trust-integrity-provider-factory.ts`) that unconditionally constructed the Null implementation for all three ports, in every environment, including production.
- **A real domain rule engine** (`fraud-detection-rules.ts`) with `detectSamePhoneClusters`, `detectSameIbanClusters`, `detectSameStripeAccountClusters`, `detectSameDeviceClusters`, plus registration-pattern and repeated-verification-failure detectors — all pure functions over caller-supplied data.
- **A real orchestration use case** (`DetectFraudSignalsUseCase`) that runs every detector, persists a `FraudSignal`, publishes `FraudDetected`, and records a Risk Score behavior signal via `RecordUserBehaviorSignalUseCase`.
- **Real persistence** for the *outcome* of fraud detection (`FraudSignal`, `TrustProfile`, `ScoreEvent` — all in `prisma/schema.prisma`), but nothing that recorded a provider *call* itself.

## 2. Root cause of the null providers

Two independent gaps, both confirmed by grep across the whole repository before writing any code:

1. **The factory never read configuration.** `createDeviceFingerprintProvider()` / `createVpnProxyDetectionProvider()` / `createPhoneReputationProvider()` each did exactly `if (!x) x = new Null...Provider(); return x;` — no env variable, no branch, no way for production to ever get anything else.
2. **Nothing called the factory outside the factory itself.** `grep -rn "createDeviceFingerprintProvider\|createVpnProxyDetectionProvider\|createPhoneReputationProvider"` matched only the three factory function *definitions* — zero call sites anywhere in `src/` or `tests/`. `DetectFraudSignalsUseCase.execute` takes pre-gathered `IdentifierCluster[]`/pattern data as input; it never queries a provider itself, and nothing upstream of it ever did either. So even a correctly-configured real provider would have changed nothing observable — the signal it produced would never have reached any caller.

Fixing only the factory (gap 1) without also wiring a real call site (gap 2) would have satisfied "providers are implemented" while leaving production behavior identical. Module 93 had to fix both.

A third, smaller gap: `VpnProxyDetectionProvider.classify(ipHash: string)`'s original signature cannot be implemented by any real IP-intelligence API — every such provider is queried by the raw IP address, which a one-way hash cannot be reversed into. Module 65's own doc comment anticipated this ("a real provider implementation resolves the raw IP server-side... from the same request context that produced the hash") but never updated the signature. This is the one interface change this module made to an existing port; see §4.

## 3. Selected providers and rationale

No provider was already specified anywhere in the repository (checked `.env.example`, `docs/`, and every port's doc comment). Selected, each isolated behind its own adapter:

| Signal | Provider | Why |
|---|---|---|
| Device fingerprint | **FingerprintJS Pro** (Server API, `Get event`) | Purpose-built for this exact signal (stable, server-verifiable `visitorId`); EU data region (`eu.api.fpjs.io`) for this Spain/EU platform; documented REST API, no SDK dependency needed for one endpoint. |
| VPN / proxy / Tor / hosting detection | **IPQualityScore (IPQS)** | Single REST call returns every field the port needs (`vpn`, `proxy`, `tor`, a datacenter/hosting signal, and a 0-100 `fraud_score`) — no second lookup; no EU-residency restriction; well-documented JSON endpoint. |
| Phone reputation | **Twilio Lookup v2** (`line_type_intelligence`) | This codebase already has a production Twilio account and credentials for SMS (Module 49, `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`) — reusing it needs zero new vendor relationship or secret. Also the candidate Module 65's own doc comment named. |

All three are called with plain `fetch`, matching this codebase's existing precedent (`PersonaClient`, `TwilioSmsSender`) of not adding a vendor SDK dependency for a small, well-documented REST surface.

## 4. New ports / adapters

```
DeviceFingerprintProvider          VpnProxyDetectionProvider          PhoneReputationProvider
        ↓                                    ↓                                  ↓
FingerprintJsDeviceFingerprintProvider  IpqsVpnProxyDetectionProvider  TwilioLookupPhoneReputationProvider
        ↓                                    ↓                                  ↓
FingerprintJS Pro Server API              IPQS REST API                Twilio Lookup v2 API
```

Files added:
- `src/core/infrastructure/trust-integrity/fingerprintjs-device-fingerprint-provider.ts`
- `src/core/infrastructure/trust-integrity/ipqs-vpn-proxy-detection-provider.ts`
- `src/core/infrastructure/trust-integrity/twilio-lookup-phone-reputation-provider.ts`
- `src/core/infrastructure/trust-integrity/phone-masking.ts` (shared log-masking helper)
- `src/core/domain/services/phone-normalization.ts` (E.164 normalization for the one real call site that collects a phone number in a looser format)

Port changes (all backward compatible for `DeviceFingerprintProvider`/`PhoneReputationProvider` — new fields only; one deliberate breaking change for `VpnProxyDetectionProvider`):
- `device-fingerprint-provider.ts`: added `provider`, `confidence`, `checkedAt` to the result.
- `phone-reputation-provider.ts`: added `carrierName`, `provider`, `checkedAt`.
- `vpn-proxy-detection-provider.ts`: added `isVpn`/`isProxy`/`isTor`/`isHosting`/`riskLevel`/`provider`/`checkedAt`; **changed `classify(ipHash: string)` to `classify({ ipHash, ip })`** — the fix described in §2. `ip` is resolved by the caller from the same request headers `getClientIpHash()` already reads (new `getClientIp()` in `request-context.ts`), used only for the outbound provider call, never logged or persisted.

New domain error: `FraudTrustProviderError` (`domain-error.ts`) — the shared, vendor-agnostic error every adapter throws for a genuine provider failure (never for "no signal"), mirroring `VerificationProviderError`'s existing shape.

New domain rule: `detectHighRiskVpnProxyAccess` (`fraud-detection-rules.ts`) — fires only for Tor, a datacenter/hosting connection, or a HIGH/CRITICAL provider risk score; a bare VPN alone (common, legitimate) never fires it on its own. Feeds a new `FraudSignalType`, `SUSPICIOUS_VPN_PROXY_ACCESS` (added to the closed union in `fraud-signal-repository.ts`, `schema.prisma`, and the migration).

`DetectFraudSignalsUseCase` was extended (not replaced) with one new optional input field, `vpnProxyRiskFindings`, wired through the same existing persist → publish → record-behavior-signal loop every other detector already uses — no new fraud engine, no duplicated logic (module brief requirement #12).

## 5. Dependency injection changes

`trust-integrity-provider-factory.ts`: each of the three `create*Provider()` functions now branches on a new env selector (`FRAUD_DEVICE_FINGERPRINT_PROVIDER` / `FRAUD_VPN_PROXY_PROVIDER` / `FRAUD_PHONE_REPUTATION_PROVIDER`). Selecting the real value with missing credentials falls back to the Null provider *with a logged warning* outside production; in production, `env.ts`'s `.superRefine` block fails startup instead (see §6) — the same two-layer "fallback in dev, fail fast in prod" shape `verification-provider-factory.ts` already established for Persona.

New orchestration use case: `CollectFraudTrustSignalsUseCase` (`application/use-cases/trust-integrity/collect-fraud-trust-signals.use-case.ts`) — the piece that did not exist at all before this module (§2, gap 2). It calls the three providers (or their Null fallback), persists a `FraudTrustSignalCheck` row per call, and — only for a *real* (non-Null) provider result — feeds device-id clusters and high-risk VPN findings into the existing `DetectFraudSignalsUseCase`. Every provider call is individually try/caught; a provider failure is recorded and logged, never rethrown, so this can safely run best-effort after a primary action has already succeeded.

Wired into `trust-integrity/compose.ts` as `makeCollectFraudTrustSignalsUseCase()`.

## 6. Configuration

New environment variables (all in `env.ts`, all optional with `.catch()`/safe defaults, `.env.example` updated):

```
FRAUD_DEVICE_FINGERPRINT_PROVIDER=null|fingerprintjs   (default: null)
FINGERPRINTJS_SECRET_API_KEY=
FINGERPRINTJS_REGION=us|eu|ap                           (default: eu)
FINGERPRINTJS_TIMEOUT_MS=                                (default: 5000)

FRAUD_VPN_PROXY_PROVIDER=null|ipqs                      (default: null)
IPQS_API_KEY=
IPQS_TIMEOUT_MS=                                         (default: 4000)

FRAUD_PHONE_REPUTATION_PROVIDER=null|twilio_lookup      (default: null)
TWILIO_LOOKUP_TIMEOUT_MS=                                (default: 5000)
# reuses TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN already in the schema
```

`env.ts`'s `.superRefine` block (production-only) now fails startup if a selector is set to its real value but the matching credential is missing — the same fail-fast rule already applied to `SMS_PROVIDER=twilio` and `VERIFICATION_PROVIDER=persona`. This closes requirement #23: production can only ever run with a Null provider via an *explicit* `null` selection, never a silent default a real provider was supposed to replace.

No secrets are hardcoded, logged, or exposed to the client — every new env var is read only inside `env.ts`/the factory/the adapters, all server-only (`import "server-only"` on the factory).

## 7. Fraud signal flow (now genuinely closed end to end)

```
Registration (src/app/auth/actions.ts registerAction)
  → getClientIpHash() + getClientIp() (raw IP resolved only here, never persisted/logged)
  → CollectFraudTrustSignalsUseCase.execute({ userId, deviceSignal?, vpnProxySignal })
        ↓ real adapters (or Null fallback)
        ↓ FraudTrustSignalCheck persisted (data-minimized)
        ↓ device-id / VPN-risk findings
  → DetectFraudSignalsUseCase.execute (existing, reused)
        ↓ FraudSignal persisted, FraudDetected published,
          RecordUserBehaviorSignalUseCase → TrustProfile.riskScore updated
```

A second real, wired checkpoint: `CompleteProfessionalOnboardingUseCase` (professional onboarding, the first point in this platform's flows where a phone number is collected) calls the same `CollectFraudTrustSignalsUseCase` for phone reputation, best-effort, after the professional profile is created.

Verified by `tests/integration/trust-integrity/fraud-trust-signal-collection-flow.test.ts` — using the **real** `IpqsVpnProxyDetectionProvider`/`FingerprintJsDeviceFingerprintProvider` classes with a deterministic mocked `fetchImpl` (never a live network call), proving: a Tor finding reaches `DetectFraudSignalsUseCase` and produces a persisted `FraudSignal` + a Risk Score change; two users sharing a real FingerprintJS `visitorId` produce a `SAME_DEVICE` signal; a provider 500 never produces a fraud signal and never throws.

## 8. Persistence

New model: `FraudTrustSignalCheck` (`prisma/schema.prisma`, migration `20260912000000_add_fraud_trust_signal_check`). Append-only — one row per real provider call, whether or not it produces a `FraudSignal` (mirrors `SecurityEvent`'s "every attempt, not just the ones that trip a rule" convention). Deliberately its own small table rather than extending `FraudSignal` — a signal *check* and a *detected* signal are different facts.

Repository: `FraudTrustSignalCheckRepository` port + `PrismaFraudTrustSignalCheckRepository`. Supports the dedupe check used for cost protection (§16) and the device-id cluster lookup `CollectFraudTrustSignalsUseCase` needs.

## 9. Privacy / GDPR decisions

Explicit, field-by-field, per the module brief's requirement #14:

| Field | Why stored | Form stored |
|---|---|---|
| `deviceIdHash` | Lets `detectSameDeviceClusters` find accounts sharing a device without ever comparing raw identifiers | SHA-256 of the provider's `visitorId` — never the raw value, never a raw browser/canvas fingerprint |
| `ipHash` | Same keyed-hash convention `SecurityEvent.ipHash` already uses | One-way keyed hash; the raw IP is used only for the single outbound IPQS call and never persisted anywhere |
| `vpnClassification`/`vpnRiskLevel`/booleans | The fraud-relevant finding itself | Coarse classification/booleans, not raw provider payload |
| `phoneValid`/`phoneLineType`/`phoneRiskScore` | The fraud-relevant finding itself | Never the phone number, not even masked — only Twilio's findings about it |
| `provider`, `success`, `latencyMs` | Observability | Non-personal |

None of this is personal data beyond what's already minimized to a hash/classification/small integer. GDPR erasure: `ExecuteAccountErasureUseCase` now hard-deletes every `FraudTrustSignalCheck` row for the erased user (new optional `fraudTrustSignalChecks` dependency, `gdpr/compose.ts` wires the real repository) — covered by both the fake-based integration test and the real-Postgres test. Admin access: none added — these rows are never surfaced in any UI; a future admin view would need its own explicit authorization, matching every other Trust & Integrity row. Never included in any log line beyond `provider`/`success`/`latencyMs`/hashes.

## 10. Resilience / failure semantics

All three adapters share one shape (mirroring `PersonaClient`): `AbortController`-based timeout, exponential backoff (`computeBackoffDelayMs`, reused — not reinvented) on network errors/timeouts/5xx/429, never on other 4xx. Explicit per-failure-class handling:

- **Timeout** → `FraudTrustProviderError(retryable: true)`, caught by `CollectFraudTrustSignalsUseCase`, recorded as an unsuccessful check, never rethrown to the caller (registration/onboarding never blocks).
- **4xx (config/auth error)** → not retried; IPQS's `success: false` (its own app-level failure signal, returned with HTTP 200) is treated identically.
- **5xx / 429** → retried with backoff, then the same non-throwing degrade.
- **Malformed response** → detected by explicit shape checks (not blind field access), logged as `fraud_provider_malformed_response`, degrades safely.
- **Missing credentials** → factory falls back to Null outside production; production fails at startup (§6) — never silently "fully protected."
- **Provider outage entirely** → every "signal unavailable" path returns `riskLevel: "UNKNOWN"` / `provider: "NULL"`-equivalent state; `detectHighRiskVpnProxyAccess` explicitly never fires for `UNKNOWN` — proven by a dedicated unit test.

## 11. Observability

Every adapter call logs one structured line via the existing `logger` (`fraud_provider_call_succeeded` / `_failed` / `_error` / `_malformed_response`), carrying `provider`, `operation`, `success`/`status`, `latencyMs`, `correlationId`, `attempt`. Phone numbers are masked (`maskPhoneForLogging`) before ever reaching a log field — proven by a dedicated test asserting the full number never appears in any logged call. `logger.ts`'s existing key-based secret redaction still applies on top. No new logging/telemetry system introduced.

## 12. Tests

- **Unit** (7 new files, ~50 tests): each adapter (success, malformed response, timeout, provider error, 4xx-no-retry, 5xx-retry, masked/no-PII logging), the factory (env-driven selection + production-shaped fallback + memoization), `CollectFraudTrustSignalsUseCase` (dedupe, clustering, never-throws, Null-provider-never-flags), `phone-masking`, `phone-normalization`, and the new `detectHighRiskVpnProxyAccess` rule.
- **Integration**: `tests/integration/trust-integrity/fraud-trust-signal-collection-flow.test.ts` — real adapter classes with mocked HTTP → real port → real `CollectFraudTrustSignalsUseCase` → real `DetectFraudSignalsUseCase` → real `fraud-detection-rules.ts`, in-memory fakes only at the repository boundary (per requirement #18, no real paid API calls in CI).
- **Real PostgreSQL** (Module 91 tier): `tests/integration-db/trust-integrity/fraud-trust-signal-check-persistence.test.ts` — round-trip, FK cascade, device-hash clustering query, dedupe-window query, GDPR-erasure deletion, and concurrent-insert safety, all against a real database.
- Extended `tests/integration/gdpr/gdpr-erasure-execution.test.ts` with one new case proving `FraudTrustSignalCheck` rows are actually deleted by the real erasure use case.

All new/modified unit and fake-backed integration tests were run in this environment: **541 unit tests pass** (full sweep of `domain/services`, `trust-integrity`, `professional`, `gdpr`, `config`, `verification`), plus the new integration test file (3/3) and the extended GDPR test (13/13) — zero regressions.

## 13. CI behavior

`npm run lint` and a scoped `npx tsc --noEmit` were run in this environment and are clean for every file this module touches. **`npx prisma generate` / `npx prisma validate` / `npm run build` / `npm run test:integration:db` could not be run in this execution environment** — this sandbox's shell is a Linux VM whose egress allowlist explicitly blocks `binaries.prisma.sh` (confirmed via `curl -I`: `403 Forbidden`, `X-Proxy-Error: blocked-by-allowlist`), so the Prisma engine binary for this schema change cannot be fetched here. This is an environment restriction, not a code defect — the two `tsc` errors that remain in this sandbox (`Property 'fraudTrustSignalCheck' does not exist on PrismaClient`, `"SUSPICIOUS_VPN_PROXY_ACCESS"` not assignable to `FraudSignalType`) are exactly the generated-client staleness that `npx prisma generate` resolves.

**Before merging, run:** `npx prisma generate && npx prisma validate && npm run typecheck && npm run lint && npm run build && npm test && npm run test:integration:db` in an environment with normal network access. Everything else in the standard CI pipeline was verified directly.

## 14. Known limitations

1. **Device fingerprinting is only half-exercised in production today.** `FingerprintJsDeviceFingerprintProvider` is real and production-capable, but it requires a client-side FingerprintJS Pro JS agent to produce a `requestId` — no such agent exists anywhere in this codebase's frontend (confirmed by search). `registerSchema` now accepts an optional `deviceSignal` field so a future frontend change can pass one through, but until that frontend work ships, every registration's device-fingerprint check silently degrades to the existing Null-equivalent fallback (never an error, per design — see the adapter's own doc comment). This is a genuine gap, stated plainly rather than glossed over.
2. **Twilio Lookup's phone-reputation risk score is MaestroYa's own heuristic**, not a vendor-supplied fraud score — Twilio's `line_type_intelligence` package does not return one (see the adapter's doc comment for the exact mapping).
3. **No automated retention/purge job** ships for `FraudTrustSignalCheck` rows. The model's doc comment recommends a 90-day operational retention window; implementing the scheduled purge itself was out of scope for this pass and should use the existing `infrastructure/jobs` scheduler.
4. **Login is not (yet) a wired checkpoint.** Registration and professional onboarding are the two business-critical checkpoints wired in this pass (per requirement #22's "meaningful coverage, not maximum provider traffic" — not every route). A VPN/proxy check at login is a reasonable future checkpoint but was deliberately left out to keep this module's scope to what could be fully implemented and tested.
5. **Phone-number normalization (`toE164`) is intentionally narrow** — it assumes a Spanish (`+34`) default for a number with no country code, not general international parsing.
6. **`npx prisma generate`/`validate`/`build`/the real-DB test tier could not be executed in this sandbox** (§13) — the schema/migration/adapter code was reviewed carefully and the equivalent logic was proven through fakes and mocked HTTP, but the developer must run the full pipeline once before merging.

## 15. Production deployment requirements

To actually enable each real provider in production:

1. **VPN/proxy detection (fully wired end-to-end today):** set `FRAUD_VPN_PROXY_PROVIDER=ipqs` and `IPQS_API_KEY`. No other change needed — the raw IP is already available from request headers.
2. **Phone reputation (wired at professional onboarding):** set `FRAUD_PHONE_REPUTATION_PROVIDER=twilio_lookup` (reuses existing `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`).
3. **Device fingerprinting (adapter ready, frontend pending):** set `FRAUD_DEVICE_FINGERPRINT_PROVIDER=fingerprintjs`, `FINGERPRINTJS_SECRET_API_KEY`, and — the required follow-up — add the FingerprintJS Pro JS agent to the registration page and pass its `requestId` through `registerSchema`'s new `deviceSignal` field.
4. Run `npx prisma generate` and apply the new migration (`prisma migrate deploy`) before starting the app with any of the above set.
5. Recommended follow-up (not blocking): a scheduled purge job for `FraudTrustSignalCheck` rows past the retention window (§14.3).
