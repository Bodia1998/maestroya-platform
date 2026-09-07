/**
 * Module 99 — Self-Billing Authorization Entry Point & Financial Document
 * Access.
 *
 * The `agreementVersion` identifier `GrantSelfBillingAuthorizationUseCase`
 * stores against every `SelfBillingAuthorization` row it creates (see that
 * repository interface's own doc comment: "a caller-supplied identifier
 * resolved against whatever configurable/versioned agreement-text store
 * the product owner maintains — out of this module's scope").
 *
 * ## This is NOT the legal agreement text
 * This constant is a version LABEL only — exactly what Module 79/85's own
 * reports flagged as still outstanding ("the actual agreement wording...
 * [is] not implemented here and must be supplied and confirmed
 * separately" — MODULE_79_IMPLEMENTATION_REPORT.md §16). Module 99 does
 * not draft, store, or render that text; it only needs a stable string to
 * record which version of a (still externally-authored) agreement a
 * professional/company's acceptance refers to, so that once real legal
 * text exists, wiring it in is a one-line change here — never a schema or
 * use-case change.
 */
export const CURRENT_SELF_BILLING_AGREEMENT_VERSION = "self-billing-agreement-es-v1" as const;
