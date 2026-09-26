import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import esTemplates from "@/i18n/messages/es/notificationTemplates.json";
import { notificationTranslator } from "@/infrastructure/notifications/recipient-notification-localizer";
import { NOTIFICATION_TEMPLATE_VARIANTS, localizeNotification } from "@/shared/i18n/notification-templates";

/** Module 120 — localized rendering of stored notifications. */

const ROOT = join(__dirname, "..", "..", "..", "..");

function collect(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) collect(path, out);
    else if (name.endsWith(".ts")) out.push(readFileSync(path, "utf8"));
  }
  return out;
}

const CORE_SOURCES = collect(join(ROOT, "src", "core")).join("\n");
const SCHEMA = readFileSync(join(ROOT, "prisma", "schema.prisma"), "utf8");
const NOTIFICATION_TYPES = new Set(
  (/enum NotificationType \{([\s\S]*?)\}/.exec(SCHEMA)?.[1] ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[A-Z_]+$/.test(line)),
);

/** Every type some use case/subscriber emits (`type: "X"` next to a notify call). */
const EMITTED_TYPES = [
  "NEW_QUOTE", "QUOTE_ACCEPTED", "QUOTE_REJECTED", "QUOTE_EXPIRED", "NEW_MESSAGE",
  "APPOINTMENT_PROPOSED", "APPOINTMENT_CONFIRMED", "APPOINTMENT_CANCELLED", "JOB_STARTED", "JOB_CANCELLED",
  "JOB_COMPLETION_CONFIRMATION_REQUESTED", "JOB_COMPLETION_CONFIRMATION_REMINDER", "JOB_COMPLETION_CONFIRMED",
  "JOB_COMPLETION_CONFIRMATION_TIMED_OUT", "MATERIALS_PURCHASE_CONFIRMED", "REVIEW_RECEIVED", "REVIEW_RESPONSE_ADDED",
  "SERVICE_REQUEST_EXPIRED", "VERIFICATION_SUBMITTED", "VERIFICATION_APPROVED", "VERIFICATION_REJECTED",
  "VERIFICATION_RESUBMISSION_REQUIRED", "VERIFICATION_EXPIRED", "COMPANY_INVITATION_RECEIVED",
  "COMPANY_INVITATION_ACCEPTED", "COMPANY_INVITATION_DECLINED", "COMPANY_MEMBER_REMOVED", "COMPANY_MEMBER_ROLE_CHANGED",
  "COMPANY_VERIFICATION_SUBMITTED", "COMPANY_VERIFICATION_APPROVED", "COMPANY_VERIFICATION_REJECTED",
  "COMPANY_VERIFICATION_RESUBMISSION_REQUIRED", "COMPANY_VERIFICATION_EXPIRED", "COMPANY_SUSPENDED",
  "COMPANY_REACTIVATED", "DISPUTE_CREATED", "DISPUTE_ASSIGNED", "DISPUTE_STATUS_CHANGED", "DISPUTE_RESPONSE_REQUESTED",
  "DISPUTE_RESOLVED", "DISPUTE_REJECTED", "DISPUTE_CLOSED", "SUPPORT_TICKET_ASSIGNED", "SUPPORT_TICKET_STATUS_CHANGED",
  "SUPPORT_TICKET_RESOLVED", "SUPPORT_TICKET_CLOSED",
];

describe("notificationTemplates catalog", () => {
  it("has a title template for every emitted NotificationType, and only for real types", () => {
    const templated = Object.keys(esTemplates).filter((key) => key !== "labels");
    for (const type of EMITTED_TYPES) expect(templated, type).toContain(type);
    for (const type of templated) expect(NOTIFICATION_TYPES.has(type), type).toBe(true);
  });

  it("only lists variant texts that subscribers still write verbatim", () => {
    const missing = Object.values(NOTIFICATION_TEMPLATE_VARIANTS)
      .flatMap((variants) => Object.keys(variants))
      .filter((text) => !CORE_SOURCES.includes(JSON.stringify(text)));
    expect(missing).toEqual([]);
  });
});

describe("localizeNotification", () => {
  const ru = notificationTranslator("ru");
  const nl = notificationTranslator("nl");
  const es = notificationTranslator("es");

  it("renders the recipient-language template with metadata arguments and status labels", () => {
    expect(
      localizeNotification(ru, {
        type: "DISPUTE_STATUS_CHANGED",
        title: "Dispute status updated",
        message: "Dispute D-1 is now under review.",
        metadata: { caseNumber: "D-1", status: "UNDER_REVIEW" },
      }),
    ).toEqual({ title: "Статус спора обновлён", message: "Новый статус спора D-1: На рассмотрении." });
  });

  it("picks the variant matching the stored English text", () => {
    expect(
      localizeNotification(nl, {
        type: "JOB_CANCELLED",
        title: "Job cancelled",
        message: "The professional cancelled this job.",
      }),
    ).toEqual({ title: "Opdracht geannuleerd", message: "De vakman heeft deze opdracht geannuleerd." });
    expect(
      localizeNotification(es, {
        type: "DISPUTE_STATUS_CHANGED",
        title: "New message on your dispute",
        message: "There's a new message on dispute D-9.",
        metadata: { caseNumber: "D-9" },
      }),
    ).toEqual({ title: "Nuevo mensaje en tu disputa", message: "Hay un nuevo mensaje en la disputa D-9." });
  });

  it("falls back to the stored text when an argument or label is missing, never rendering a broken template", () => {
    const stored = {
      type: "COMPANY_MEMBER_ROLE_CHANGED",
      title: "Your role has changed",
      message: "Your role in the company was changed to MANAGER.",
    };
    expect(localizeNotification(ru, stored)).toEqual({
      title: "Ваша роль изменена",
      message: "Your role in the company was changed to MANAGER.",
    });
    expect(localizeNotification(ru, { ...stored, metadata: { role: "MANAGER" } }).message).toBe(
      "Ваша роль в компании теперь: Менеджер.",
    );
    expect(localizeNotification(ru, { ...stored, metadata: { role: "UNKNOWN_ROLE" } }).message).toBe(stored.message);
  });

  it("keeps user-generated content (chat previews) and unknown types as stored", () => {
    expect(localizeNotification(es, { type: "NEW_MESSAGE", title: "New message", message: "Hola, ¿mañana?" })).toEqual({
      title: "Nuevo mensaje",
      message: "Hola, ¿mañana?",
    });
    expect(localizeNotification(es, { type: "SOMETHING_NEW", title: "T", message: "M" })).toEqual({
      title: "T",
      message: "M",
    });
  });
});
