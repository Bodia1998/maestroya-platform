import type { SmsMessage, SmsSender } from "@/application/interfaces/sms-sender";

/**
 * Module 49 — SMS Notifications.
 *
 * `SmsSender` backed by Twilio's REST API, called with plain `fetch` and
 * HTTP Basic Auth rather than the `twilio` npm SDK.
 *
 * This is a deliberate departure from `ResendEmailSender`'s choice (that
 * class adds the `resend` package as a real dependency — see
 * `infrastructure/email/resend-email-sender.ts`). The two providers are
 * not symmetric: Resend's SDK is a thin, actively used wrapper this
 * codebase already depends on for every transactional email; adding an
 * entire SDK (with its own dependency tree) for a single `POST` to one
 * well-documented REST endpoint would be the heavier choice for no
 * behavioral benefit — Twilio's Messages API is exactly one endpoint, one
 * auth scheme (HTTP Basic, Account SID + Auth Token), and one response
 * shape. Using `fetch` directly keeps this module's footprint to the
 * platform's own dependencies, consistent with the "reuse existing
 * abstractions, avoid unnecessary new dependencies" constraint this
 * module was built under.
 *
 * Fails loudly (throws) on a non-2xx response, exactly like
 * `ResendEmailSender` does for a Resend API error — the caller (the SMS
 * dispatch job processor, `infrastructure/sms/sms-dispatch-job-
 * processor.ts`) is what turns a throw into a scheduled retry, never this
 * class.
 */
export class TwilioSmsSender implements SmsSender {
  private static readonly API_BASE = "https://api.twilio.com/2010-04-01";

  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
    private readonly fromNumber: string,
    /** Injectable for tests; defaults to the global `fetch`. */
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(message: SmsMessage): Promise<void> {
    const url = `${TwilioSmsSender.API_BASE}/Accounts/${encodeURIComponent(this.accountSid)}/Messages.json`;

    const body = new URLSearchParams({
      To: message.to,
      From: this.fromNumber,
      Body: message.body,
    });

    const credentials = Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64");

    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const detail = await safeReadBody(response);
      throw new Error(`Failed to send SMS via Twilio (HTTP ${response.status}): ${detail}`);
    }
  }
}

async function safeReadBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "<unreadable response body>";
  }
}
