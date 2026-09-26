/**
 * Module 120 — Multilingual Localization: localized rendering of stored
 * notifications.
 *
 * Notifications are persisted with an English `title`/`message` (that is
 * what every subscriber writes, and it stays the audit/fallback text — no
 * data is ever rewritten). What a person *sees* is rendered at read/delivery
 * time from `notificationTemplates.<TYPE>.title|message`, in the reader's
 * language, with ICU arguments taken from the notification's `metadata`.
 *
 * A few types are emitted with more than one wording (e.g. "submitted" vs
 * "resubmitted", "the customer cancelled" vs "the professional
 * cancelled"). Those wordings are told apart deterministically by the
 * stored English text (`NOTIFICATION_TEMPLATE_VARIANTS` below), which also
 * works for rows written before this module existed; the matching
 * templates live under `notificationTemplates.<TYPE>.variants.<variant>`.
 * `notification-template-variants.test.ts` fails if a subscriber's English
 * text changes without this table following.
 *
 * Safety rules — each field falls back to the stored text when:
 * - there is no template for it (e.g. `NEW_MESSAGE.message`: the stored
 *   message is the user's own chat preview and is never translated);
 * - the template needs an argument the stored metadata does not carry
 *   (older rows, or a subscriber that never wrote it);
 * - an enum-valued argument (`status`, `role`) has no label;
 * - rendering throws for any reason.
 * A broken or half-rendered template is never shown.
 *
 * Lives in `shared/` because both edges use it: the request edge
 * (`presentation/i18n/notifications.ts`, Server Actions) and the
 * out-of-band delivery channels in infrastructure, which render in the
 * *recipient's* language rather than the current request's.
 *
 * Pure: the caller supplies a translator bound to `notificationTemplates`
 * (`getTranslations("notificationTemplates")` for the request's locale, or
 * `createTranslator` over the recipient's locale in infrastructure).
 */

export interface NotificationTemplateTranslator {
  (key: string, values?: Record<string, string | number>): string;
  has(key: string): boolean;
  raw(key: string): unknown;
}

export interface StoredNotificationText {
  /** A `NotificationType` enum value. */
  type: string;
  title: string;
  message: string;
  metadata?: Record<string, unknown> | null;
}

export interface LocalizedNotificationText {
  title: string;
  message: string;
}

/** Stored English title or message → template variant, per type. */
export const NOTIFICATION_TEMPLATE_VARIANTS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  VERIFICATION_SUBMITTED: { "Verification request resubmitted": "resubmitted" },
  VERIFICATION_APPROVED: {
    "Your automated identity verification passed. A verified badge now appears on your public profile.": "automated",
  },
  VERIFICATION_REJECTED: {
    "Your automated identity verification was not successful. Open your verification page to see why and try again.":
      "automated",
  },
  VERIFICATION_RESUBMISSION_REQUIRED: { "Business registration document required": "businessRegistration" },
  COMPANY_VERIFICATION_SUBMITTED: { "Verification request resubmitted": "resubmitted" },
  COMPANY_MEMBER_ROLE_CHANGED: { "You are now the company owner": "ownershipTransferred" },
  DISPUTE_STATUS_CHANGED: { "New message on your dispute": "newMessage" },
  APPOINTMENT_PROPOSED: {
    "The customer proposed a new appointment time.": "byCustomer",
    "The professional proposed a new appointment time.": "byProfessional",
  },
  APPOINTMENT_CONFIRMED: {
    "The customer confirmed the appointment time.": "byCustomer",
    "The professional confirmed the appointment time.": "byProfessional",
  },
  APPOINTMENT_CANCELLED: {
    "The customer cancelled this appointment.": "byCustomer",
    "The professional cancelled this appointment.": "byProfessional",
  },
  JOB_CANCELLED: {
    "The customer cancelled this job.": "byCustomer",
    "The professional cancelled this job.": "byProfessional",
  },
};

/** Enum-valued metadata fields rendered through a label, never raw. */
function labelGroupFor(type: string, arg: string): string | null {
  if (arg === "status") {
    if (type.startsWith("DISPUTE_")) return "labels.disputeStatus";
    if (type.startsWith("SUPPORT_TICKET_")) return "labels.ticketStatus";
    return null;
  }
  if (arg === "role") return "labels.companyRole";
  return null;
}

const ARGUMENT_PATTERN = /\{\s*([A-Za-z0-9_]+)\s*[,}]/g;

function argumentsOf(template: string): string[] {
  return [...new Set([...template.matchAll(ARGUMENT_PATTERN)].map((match) => match[1] as string))];
}

function variantOf(notification: StoredNotificationText): string | null {
  const variants = NOTIFICATION_TEMPLATE_VARIANTS[notification.type];
  if (!variants) return null;
  return variants[notification.title] ?? variants[notification.message] ?? null;
}

function renderField(
  t: NotificationTemplateTranslator,
  notification: StoredNotificationText,
  field: "title" | "message",
  variant: string | null,
): string {
  const stored = notification[field];
  const candidates = [
    ...(variant ? [`${notification.type}.variants.${variant}.${field}`] : []),
    `${notification.type}.${field}`,
  ];

  try {
    const key = candidates.find((candidate) => t.has(candidate));
    if (!key) return stored;

    const template = t.raw(key);
    if (typeof template !== "string") return stored;

    const metadata = notification.metadata ?? {};
    const values: Record<string, string | number> = {};
    for (const arg of argumentsOf(template)) {
      const value = metadata[arg];
      if (typeof value !== "string" && typeof value !== "number") return stored;
      const labelGroup = labelGroupFor(String(notification.type), arg);
      if (labelGroup) {
        const labelKey = `${labelGroup}.${String(value)}`;
        if (!t.has(labelKey)) return stored;
        values[arg] = t(labelKey);
      } else {
        values[arg] = value;
      }
    }
    return t(key, values);
  } catch {
    return stored;
  }
}

export function localizeNotification(
  t: NotificationTemplateTranslator,
  notification: StoredNotificationText,
): LocalizedNotificationText {
  const variant = variantOf(notification);
  return {
    title: renderField(t, notification, "title", variant),
    message: renderField(t, notification, "message", variant),
  };
}
