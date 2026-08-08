export interface SmsMessage {
  /** E.164-formatted recipient phone number (e.g. `+34600000000`). */
  to: string;
  /** Plain-text SMS body. Callers are responsible for keeping it
   *  SMS-appropriate (short, no HTML/markup) — see
   *  `infrastructure/sms/sms-template-renderer.ts`. */
  body: string;
}

/**
 * Module 49 — SMS Notifications.
 *
 * Port for sending a transactional SMS. Application code (the SMS
 * dispatch job processor — see `infrastructure/sms/sms-dispatch-job-
 * processor.ts`) depends on this interface only, never on a concrete
 * provider — the exact same dependency-inversion discipline
 * `EmailSender` (`application/interfaces/email-sender.ts`) already
 * establishes for email, and documented in docs/ARCHITECTURE.md for
 * PaymentGateway/FileStorage. `TwilioSmsSender` and `MockSmsSender`
 * (`infrastructure/sms/`) are its only implementations.
 */
export interface SmsSender {
  send(message: SmsMessage): Promise<void>;
}
