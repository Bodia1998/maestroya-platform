/**
 * Ambient module declaration for `@sentry/nextjs` (Module 39 — Sentry +
 * CI/CD Hardening).
 *
 * `@sentry/nextjs` is listed as a real dependency in `package.json` and
 * ships its own complete types — this file exists only so the codebase
 * type-checks in environments where `npm install` hasn't fetched it yet
 * (e.g. an offline sandbox). Once `npm install` has actually run with
 * registry access, TypeScript resolves the package's own `.d.ts` files
 * from `node_modules` normally; this ambient declaration is a fallback,
 * not the source of truth, and can be deleted once every environment
 * that type-checks this repository has the real package installed.
 *
 * Deliberately untyped (`any`) rather than hand-modeling Sentry's API
 * surface — every call site (`sentry-client.ts`) already narrows what it
 * uses immediately after import, and duplicating Sentry's own types here
 * would drift out of sync with the real package.
 */
declare module "@sentry/nextjs";
