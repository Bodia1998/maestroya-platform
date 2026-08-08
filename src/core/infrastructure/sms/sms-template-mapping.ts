import type { SmsTemplateKey } from "@/infrastructure/sms/sms-message-catalog";
import { renderSmsTemplate, SMS_SINGLE_SEGMENT_LIMIT } from "@/infrastructure/sms/sms-template-renderer";
import type { SmsDispatchJobData } from "@/infrastructure/sms/sms-jobs";

/**
 * Module 49 — SMS Notifications.
 *
 * Maps a `NotificationTypeValue` (`domain/repositories/notification-
 * repository.ts`) onto the `SmsTemplateKey` (`sms-message-catalog.ts`)
 * whose copy fits it, for every existing notification type this platform
 * already raises that has an obvious SMS-worthy counterpart.
 *
 * `passwordReset` / `phoneVerification` / `twoFactorAuthentication` are
 * deliberately **not** reachable from this map: this codebase has no
 * `NotificationTypeValue` for any of the three today —
 * `RequestPasswordResetUseCase` sends its reset link by email directly
 * (`application/use-cases/auth/request-password-reset.use-case.ts`), and
 * there is no phone-verification or 2FA flow anywhere in the codebase to
 * raise a type for (the module brief calls these "stub/future-ready" for
 * exactly this reason). Their templates are fully implemented and
 * covered by this module's own tests
 * (`tests/unit/core/infrastructure/sms/sms-template-renderer.test.ts`) so
 * a future module can call `renderSmsTemplate("passwordReset", ...)` (or
 * the other two) directly, without touching this file, the moment a real
 * caller exists — see docs/MODULE_49_SMS_NOTIFICATIONS.md, "Future work".
 *
 * A type with no entry here is not an error: `buildSmsBody` below falls
 * back to the channel-agnostic `fallbackMessage` every
 * `NotificationChannelPayload` already carries, truncated to a single SMS
 * segment. Nothing therefore *needs* an entry in this map to be SMS-
 * deliverable — this map only decides which types get the nicer, more
 * concise, purpose-written copy.
 */
export const SMS_TEMPLATE_BY_NOTIFICATION_TYPE: Partial<Record<string, SmsTemplateKey>> = {
  QUOTE_ACCEPTED: "quoteAccepted",
  QUOTE_REJECTED: "quoteRejected",
  APPOINTMENT_PROPOSED: "appointmentReminder",
  APPOINTMENT_CONFIRMED: "bookingConfirmed",
  JOB_STARTED: "professionalAssigned",
  NEW_MESSAGE: "chatNotification",
  DISPUTE_CREATED: "disputeNotification",
  DISPUTE_ASSIGNED: "disputeNotification",
  DISPUTE_STATUS_CHANGED: "disputeNotification",
  SERVICE_REQUEST_EXPIRED: "serviceRequestUpdated",
  QUOTE_EXPIRED: "serviceRequestUpdated",
};

/**
 * Best-effort extraction of template variables from a job's `metadata` —
 * whatever the caller attached to the original `NotificationRequest`
 * (see e.g. `NotifyDisputeCreatedSubscriber`'s `metadata: { jobId,
 * caseNumber }`). Values are coerced to `string`; a missing key resolves
 * to `renderSmsTemplate`'s own "leave the placeholder literal" fallback
 * rather than throwing — a partially-populated SMS is still far more
 * useful than a failed, dead-lettered job.
 */
function extractVariables(metadata: Record<string, unknown> | null | undefined): Record<string, string> {
  if (!metadata) return {};
  const variables: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      variables[key] = String(value);
    }
  }
  return variables;
}

/**
 * The single entry point the SMS dispatch job processor calls: given the
 * job's payload, decide the final SMS body. Templated when `type` has a
 * mapping and every placeholder its template needs is present in
 * `metadata`'s keys; the generic `fallbackMessage` (truncated to one
 * segment) otherwise.
 */
export function buildSmsBody(data: SmsDispatchJobData): string {
  const templateKey = SMS_TEMPLATE_BY_NOTIFICATION_TYPE[data.type];
  if (templateKey) {
    return renderSmsTemplate(templateKey, data.locale, extractVariables(data.metadata));
  }
  return truncateToSingleSegment(data.fallbackMessage);
}

function truncateToSingleSegment(message: string): string {
  if (message.length <= SMS_SINGLE_SEGMENT_LIMIT) return message;
  return `${message.slice(0, SMS_SINGLE_SEGMENT_LIMIT - 1)}…`;
}
