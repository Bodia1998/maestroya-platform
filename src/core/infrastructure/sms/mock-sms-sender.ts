import type { SmsMessage, SmsSender } from "@/application/interfaces/sms-sender";

/**
 * Module 49 — SMS Notifications.
 *
 * In-memory `SmsSender` — the SMS module's counterpart to
 * `ConsoleEmailSender` (`infrastructure/email/console-email-sender.ts`),
 * except it also *records* every message rather than only logging it, so
 * unit/integration tests can assert on exactly what would have been sent
 * without a real Twilio account. This is what `SMS_PROVIDER=mock` (the
 * default — see `infrastructure/config/env.ts`) wires in everywhere: local
 * dev, CI, and any environment that has not deliberately opted into a real
 * provider.
 *
 * Deliberately total: `send` never throws, matching `MockEmailSender`-style
 * fakes elsewhere in this codebase's test utilities — a test that wants to
 * exercise the *failure* path (retry, dead-letter) constructs its own
 * throwing stub instead of reconfiguring this one.
 */
export class MockSmsSender implements SmsSender {
  private readonly sent: SmsMessage[] = [];

  async send(message: SmsMessage): Promise<void> {
    this.sent.push(message);
  }

  /** Every message sent so far, oldest first. A fresh copy — callers must
   *  not mutate this array to affect the sender's own state. */
  get messages(): readonly SmsMessage[] {
    return [...this.sent];
  }

  /** The most recently sent message, or `null` if none has been sent. */
  get lastMessage(): SmsMessage | null {
    return this.sent.length > 0 ? (this.sent[this.sent.length - 1] ?? null) : null;
  }

  /** Test/dev convenience — clears recorded history without recreating the instance. */
  clear(): void {
    this.sent.length = 0;
  }
}
