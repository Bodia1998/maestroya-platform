import "server-only";

import type { EmailMessage, EmailSender } from "@/application/interfaces/email-sender";
import type {
  NotificationChannel,
  NotificationChannelAdapter,
  NotificationChannelPayload,
} from "@/application/ports/notification-channel";
import type { TracingPort } from "@/application/ports/tracing";

/**
 * Module 51 — Distributed Tracing — outbound delivery adapters.
 *
 * Two decorators over two *unmodified* existing seams, wired at the
 * composition roots that already construct them
 * (`application/use-cases/auth/compose.ts` and
 * `infrastructure/notifications/notification-dispatcher.compose.ts`):
 *
 *  - **`TracedEmailSender`** over `EmailSender`
 *    (`application/interfaces/email-sender.ts`) — covers
 *    `ResendEmailSender` and `ConsoleEmailSender` alike, so a verification
 *    email's latency is attributable to Resend rather than to "the
 *    registration use case was slow".
 *  - **`TracedNotificationChannel`** over `NotificationChannelAdapter`
 *    (`application/ports/notification-channel.ts`) — the realtime
 *    gateway's outbound boundary, plus every other channel the dispatcher
 *    fans out to, with `notification.channel` as the distinguishing
 *    attribute.
 *
 * Twilio is deliberately *not* here: `TwilioSmsSender` already takes an
 * injectable `fetchImpl`, so it is instrumented one level lower by
 * `createTracedFetch("twilio")` in `sms-sender-factory.ts` — which
 * additionally propagates trace context on the wire, something a
 * sender-level decorator cannot do. Stripe is instrumented the same way,
 * through its SDK's own `httpClient` seam. See
 * docs/MODULE_51_DISTRIBUTED_TRACING.md §5 for the full "which seam, and
 * why" table.
 *
 * Neither decorator changes behaviour: same arguments, same resolution,
 * same rejection. In particular `TracedNotificationChannel.send` keeps
 * the adapter's best-effort contract intact — it neither adds a `catch`
 * nor removes one.
 */
export class TracedEmailSender implements EmailSender {
  constructor(
    private readonly delegate: EmailSender,
    private readonly tracer: TracingPort,
    private readonly system: string,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    return this.tracer.withSpan("email.send", () => this.delegate.send(message), {
      kind: "client",
      attributes: {
        "external.system": this.system,
        // Never the recipient address or the rendered HTML: an exported
        // span is as sensitive a destination as a log line, where
        // `logger.ts` already redacts this class of value. The subject is
        // a fixed template string chosen by this codebase, not user
        // input, so it is safe and is the one field that identifies
        // *which* email this was.
        "email.subject": message.subject,
      },
    });
  }
}

export class TracedNotificationChannel implements NotificationChannelAdapter {
  constructor(
    private readonly delegate: NotificationChannelAdapter,
    private readonly tracer: TracingPort,
  ) {}

  get channel(): NotificationChannel {
    return this.delegate.channel;
  }

  async send(payload: NotificationChannelPayload): Promise<void> {
    return this.tracer.withSpan(`notification.send ${this.delegate.channel}`, () => this.delegate.send(payload), {
      kind: "client",
      attributes: {
        "external.system": `notification:${this.delegate.channel.toLowerCase()}`,
        "notification.channel": this.delegate.channel,
        "notification.category": payload.category,
        "notification.type": payload.type,
      },
    });
  }
}

/** Wraps only when tracing is on — otherwise the sender is untouched. */
export function withEmailTracing(sender: EmailSender, tracer: TracingPort, system = "resend"): EmailSender {
  return tracer.enabled ? new TracedEmailSender(sender, tracer, system) : sender;
}

/** Wraps only when tracing is on — otherwise the adapter is untouched. */
export function withNotificationChannelTracing(
  adapter: NotificationChannelAdapter,
  tracer: TracingPort,
): NotificationChannelAdapter {
  return tracer.enabled ? new TracedNotificationChannel(adapter, tracer) : adapter;
}
