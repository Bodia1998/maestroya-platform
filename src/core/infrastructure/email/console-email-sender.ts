import type { EmailMessage, EmailSender } from "@/application/interfaces/email-sender";

/**
 * Logs emails to the console instead of sending them. No email provider
 * (Resend/SES/Postmark/etc.) was specified for this module, and inventing
 * a specific vendor integration wasn't part of the Authentication scope
 * — this keeps register/verify/forgot-password fully working end-to-end
 * in development while making the missing piece obvious and easy to
 * swap out (implement EmailSender, change the one wiring point in
 * auth-config.ts / the use-cases' composition, done).
 */
export class ConsoleEmailSender implements EmailSender {
  async send(message: EmailMessage): Promise<void> {
    console.log("\n--- Email (ConsoleEmailSender — not actually sent) ---");
    console.log(`To: ${message.to}`);
    console.log(`Subject: ${message.subject}`);
    console.log(message.html);
    console.log("--- end email ---\n");
  }
}
