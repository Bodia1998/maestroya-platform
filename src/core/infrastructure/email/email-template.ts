/**
 * Module 32 — Notifications & Real-Time Communication.
 *
 * Small, shared HTML fragments for transactional email bodies. Extracted
 * from duplicated inline template literals found during this module's
 * audit: `RegisterUserUseCase` and `RequestPasswordResetUseCase`
 * (`application/use-cases/auth/`) each independently composed an
 * "intro paragraph + link paragraph + expiry note paragraph" HTML string
 * by hand, with the exact same shape and no shared source. Both now call
 * `renderActionLinkEmailHtml` below instead — same rendered output (this
 * repository's existing auth integration tests extract the token from the
 * link via a regex over the emitted `html`, so byte-for-byte structure
 * around the link path was preserved), one place to change if the
 * transactional-email look is ever updated.
 *
 * `renderNotificationEmailHtml` is the shape `EmailNotificationChannel`
 * (`infrastructure/notifications/channels/email-notification-channel.ts`)
 * uses for the generic "you have a notification" case — a distinct,
 * slightly more general shape (no fixed "expiry note"), kept as a second
 * small function rather than overloading the auth-specific one with
 * optional fields it doesn't need.
 *
 * Deliberately not a full HTML-email templating system (no MJML, no
 * external template files, no new dependency) — this module's brief is to
 * consolidate duplication that already existed, not to build a general
 * email-design system nothing in this codebase asked for.
 */

export function renderActionLinkEmailHtml(params: {
  intro: string;
  actionUrl: string;
  expiryNote: string;
}): string {
  const { intro, actionUrl, expiryNote } = params;
  return `<p>${intro}</p><p><a href="${actionUrl}">${actionUrl}</a></p><p>${expiryNote}</p>`;
}

export function renderNotificationEmailHtml(params: {
  title: string;
  message: string;
  actionUrl?: string | null;
}): string {
  const { title, message, actionUrl } = params;
  const link = actionUrl
    ? `<p><a href="${actionUrl}">${actionUrl}</a></p>`
    : "";
  return `<p><strong>${title}</strong></p><p>${message}</p>${link}`;
}
