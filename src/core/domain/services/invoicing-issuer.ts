/**
 * Module 79 — Invoicing & Credit Notes: MaestroYa's own legal-identity
 * fields as the issuer of record on every self-billed invoice AND
 * (Module 85) every customer-facing receipt (`InvoiceType.CUSTOMER_RECEIPT`)
 * — MaestroYa is the marketplace's merchant/issuer of record for both
 * document types, so this stays the single source of truth for "who is
 * MaestroYa, legally" rather than a second, type-specific pair of
 * constants.
 *
 * Kept as two small named constants (mirroring
 * `commission-policy.ts`'s `DEFAULT_COMMISSION_RATES`) rather than
 * hardcoded string literals inline in a use case, so a future move to a
 * real configuration store (a `PlatformSetting` row, the same mechanism
 * `CommissionRateRepository` already uses for the commission rate) is a
 * one-line change here, never a change to `CreateProfessionalInvoiceDraftUseCase`
 * itself.
 *
 * ## Module 85 — environment-configurable, with a fail-loud placeholder
 * Read from `MAESTROYA_ISSUER_LEGAL_NAME`/`MAESTROYA_ISSUER_TAX_ID` when
 * set (a real deployment's `.env`), falling back to the same placeholder
 * values Module 79 shipped with otherwise. `PENDING-CIF-CONFIRMATION` is
 * never a legally valid tax ID — `isPlaceholderIssuerTaxId` lets
 * `IssueInvoiceUseCase` refuse to issue a real invoice/receipt while it is
 * still set (see `IssuerTaxIdNotConfiguredError`), rather than silently
 * numbering and hashing a legally invalid document. The product owner
 * must supply MaestroYa's real registered legal name and CIF/NIF via
 * environment configuration before any invoice this module produces is
 * used in production — see MODULE_79_IMPLEMENTATION_REPORT.md,
 * "Remaining risks," and MODULE_85_IMPLEMENTATION_REPORT.md.
 */
const ISSUER_TAX_ID_PLACEHOLDER = "PENDING-CIF-CONFIRMATION";
const ISSUER_LEGAL_NAME_DEFAULT = "MaestroYa Platform Services, S.L.";

export const MAESTROYA_ISSUER_LEGAL_NAME = process.env.MAESTROYA_ISSUER_LEGAL_NAME?.trim() || ISSUER_LEGAL_NAME_DEFAULT;
export const MAESTROYA_ISSUER_TAX_ID = process.env.MAESTROYA_ISSUER_TAX_ID?.trim() || ISSUER_TAX_ID_PLACEHOLDER;

/** True when `issuerTaxId` is still the unconfirmed placeholder — see
 *  this file's own doc comment. Never true for a real CIF/NIF, whatever
 *  its format, since this is an exact-string check against the one
 *  known-invalid sentinel value, never a format/checksum validation
 *  (Spanish CIF/NIF format validation is out of this module's scope). */
export function isPlaceholderIssuerTaxId(issuerTaxId: string): boolean {
  return issuerTaxId === ISSUER_TAX_ID_PLACEHOLDER;
}
