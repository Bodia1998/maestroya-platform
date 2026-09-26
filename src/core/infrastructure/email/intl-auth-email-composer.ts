import { createTranslator } from "use-intl/core";

import type { AuthEmailComposer, AuthEmailParams, ComposedEmail } from "@/application/ports/auth-email-composer";
import { getMessages } from "@/infrastructure/i18n/message-loader";
import { DEFAULT_LOCALE, toLocale, type Locale } from "@/shared/i18n/locales";

/**
 * Module 120 — Multilingual Localization: `AuthEmailComposer` backed by
 * the `emails` message namespace (`emails.common.*`, `emails.verifyEmail.*`,
 * `emails.resetPassword.*`), rendered with use-intl's ICU engine for the
 * requested locale (fallback: Spanish, per-key fallback via
 * `getMessages`). No new legal claims — only the existing transactional
 * wording.
 *
 * The emitted HTML keeps the action URL verbatim in an `href` (and once as
 * visible text for clients that strip links), so token extraction and the
 * existing integration tests are unaffected. Every interpolated value is
 * HTML-escaped; the recipient's name is user-supplied.
 */
type EmailKind = "verifyEmail" | "resetPassword";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export class IntlAuthEmailComposer implements AuthEmailComposer {
  composeVerifyEmail(params: AuthEmailParams): ComposedEmail {
    return this.compose("verifyEmail", params, false);
  }

  composePasswordReset(params: AuthEmailParams): ComposedEmail {
    return this.compose("resetPassword", params, true);
  }

  private compose(kind: EmailKind, params: AuthEmailParams, withIgnoreNotice: boolean): ComposedEmail {
    const locale: Locale = toLocale(params.locale) ?? DEFAULT_LOCALE;
    const t = createTranslator({
      locale,
      messages: getMessages(locale) as never,
      namespace: "emails" as never,
    }) as unknown as (key: string, values?: Record<string, string | number>) => string;

    const hours = Math.max(1, Math.round(params.ttlMs / (60 * 60 * 1000)));
    const url = escapeHtml(params.actionUrl);
    const name = params.name?.trim();

    const paragraphs = [
      ...(name ? [escapeHtml(t("common.greeting", { name }))] : []),
      escapeHtml(t(`${kind}.body`)),
      `<a href="${url}">${escapeHtml(t(`${kind}.cta`))}</a>`,
      escapeHtml(t(`${kind}.expiresIn`, { hours })),
      ...(withIgnoreNotice ? [escapeHtml(t("common.ignoreNotice"))] : []),
      `${escapeHtml(t("common.linkFallback"))}<br>${url}`,
      escapeHtml(t("common.signature")),
    ];

    return {
      subject: t(`${kind}.subject`),
      html: paragraphs.map((p) => `<p>${p}</p>`).join(""),
    };
  }
}
