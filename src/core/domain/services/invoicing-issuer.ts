/**
 * Module 79 — Invoicing & Credit Notes: MaestroYa's own legal-identity
 * fields as the issuer of record on every self-billed invoice.
 *
 * Kept as two small named constants (mirroring
 * `commission-policy.ts`'s `DEFAULT_COMMISSION_RATES`) rather than
 * hardcoded string literals inline in a use case, so a future move to a
 * real configuration store (a `PlatformSetting` row, the same mechanism
 * `CommissionRateRepository` already uses for the commission rate) is a
 * one-line change here, never a change to `CreateProfessionalInvoiceDraftUseCase`
 * itself.
 *
 * PLACEHOLDER VALUES: these are NOT confirmed legal entity details. The
 * product owner must supply MaestroYa's real registered legal name and
 * CIF/NIF before any invoice this module produces is used in production —
 * see MODULE_79_IMPLEMENTATION_REPORT.md, "Remaining risks."
 */
export const MAESTROYA_ISSUER_LEGAL_NAME = "MaestroYa Platform Services, S.L.";
export const MAESTROYA_ISSUER_TAX_ID = "PENDING-CIF-CONFIRMATION";
