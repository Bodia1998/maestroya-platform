import type {
  NotificationChannel,
  NotificationChannelAdapter,
  NotificationChannelPayload,
} from "@/application/ports/notification-channel";
import type { EmailSender } from "@/application/interfaces/email-sender";
import { renderNotificationEmailHtml } from "@/infrastructure/email/email-template";
import { env } from "@/infrastructure/config/env";

/**
 * Module 32 — Notifications & Real-Time Communication.
 *
 * `EMAIL` channel adapter: reuses this codebase's existing `EmailSender`
 * port (the same one `RegisterUserUseCase`/`RequestPasswordResetUseCase`
 * already depend on, backed by `ResendEmailSender`/`ConsoleEmailSender`,
 * see `application/use-cases/auth/compose.ts`) — no new provider, no new
 * dependency, no change to how email is actually sent.
 *
 * `actionUrl` on a `NotificationChannelPayload` is validated elsewhere
 * (`domain/services/notification-rules.ts`'s `isSafeActionUrl`) to always
 * be a same-origin *relative* path (e.g. `/jobs/123`) — correct for an
 * in-app link, but not clickable from an email client. This adapter is
 * the one place that resolves it against `NEXT_PUBLIC_APP_URL` into an
 * absolute link before rendering.
 *
 * If no recipient email is available, this is a safe no-op (logged, not
 * thrown) — the caller may not always have resolved one, and a missing
 * email address must never fail the primary operation that triggered the
 * notification.
 */
export class EmailNotificationChannel implements NotificationChannelAdapter {
  readonly channel: NotificationChannel = "EMAIL";

  constructor(private readonly emailSender: EmailSender) {}

  async send(payload: NotificationChannelPayload): Promise<void> {
    if (!payload.email) {
      console.warn(
        `EmailNotificationChannel: skipped — no recipient email for userId=${payload.userId}, type=${payload.type}.`,
      );
      return;
    }

    const absoluteActionUrl = payload.actionUrl
      ? new URL(payload.actionUrl, env.NEXT_PUBLIC_APP_URL).toString()
      : null;

    await this.emailSender.send({
      to: payload.email,
      subject: payload.title,
      html: renderNotificationEmailHtml({
        title: payload.title,
        message: payload.message,
        actionUrl: absoluteActionUrl,
      }),
    });
  }
}
