/**
 * Module 120 — Multilingual Localization: composes the transactional auth
 * emails (email verification, password reset) in a given language.
 *
 * The application layer decides *which* email, *to whom*, with *which*
 * link and TTL, and *which locale code* applies — it never carries prose.
 * The wording lives in the `emails` message namespace and is rendered by
 * the infrastructure implementation (`IntlAuthEmailComposer`). An unknown
 * or missing locale falls back to Spanish (the platform default).
 */
export interface ComposedEmail {
  subject: string;
  html: string;
}

export interface AuthEmailParams {
  /** Locale code (e.g. "es", "ru"); anything unsupported → Spanish. */
  locale?: string | null;
  /** Recipient's display name, if known (user-supplied — escaped by the composer). */
  name?: string | null;
  /** Absolute action URL (contains the one-time token). */
  actionUrl: string;
  /** How long the link stays valid, in milliseconds. */
  ttlMs: number;
}

export interface AuthEmailComposer {
  composeVerifyEmail(params: AuthEmailParams): ComposedEmail;
  composePasswordReset(params: AuthEmailParams): ComposedEmail;
}
