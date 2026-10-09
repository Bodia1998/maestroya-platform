import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Module 145 — static contract for LEAD_V1 lead notifications.
 *
 * Pins: pure domain/application layers; notifications raised ONLY by the authoritative
 * boundaries (never UI/browser/polling); no second webhook/state machine; the legacy
 * payment path knows nothing about them; privacy-by-construction of the content; and an
 * additive-only, DB-enforced idempotency schema.
 */
const root = path.resolve(__dirname, "../../..");
const read = (f: string) => readFileSync(path.join(root, f), "utf8");
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const rel = (p: string) => path.relative(root, p).split(path.sep).join("/");
const SRC = walk(path.join(root, "src")).map(rel).filter((f) => /\.(ts|tsx)$/.test(f));

const DOMAIN_FILES = [
  "src/core/domain/events/lead-published.ts",
  "src/core/domain/events/lead-purchase-confirmed.ts",
  "src/core/domain/events/lead-purchase-cancelled.ts",
  "src/core/domain/services/lead-notification.ts",
  "src/core/domain/repositories/lead-notification-context-reader.ts",
];
const SUBSCRIBERS = [
  "src/core/application/use-cases/notification/notify-lead-published.subscriber.ts",
  "src/core/application/use-cases/notification/notify-lead-purchase-confirmed.subscriber.ts",
  "src/core/application/use-cases/notification/notify-lead-purchase-cancelled.subscriber.ts",
  "src/core/application/use-cases/notification/lead-notification-sender.ts",
];
const NOTIFICATION_PIECES = [...DOMAIN_FILES, ...SUBSCRIBERS, "src/core/application/use-cases/notification/create-idempotent-notification.use-case.ts"];

describe("M145 layering", () => {
  it.each(DOMAIN_FILES)("%s (domain) has no Prisma / Next / Stripe / email SDK / infrastructure import", (f) => {
    expect(code(f)).not.toMatch(/@prisma\/client|from "next|from 'next|stripe|resend|twilio|@\/infrastructure|@\/application|@\/presentation/i);
  });

  it.each(NOTIFICATION_PIECES)("%s (application/domain) imports no infrastructure, Prisma, Next or provider SDK", (f) => {
    expect(code(f)).not.toMatch(/@\/infrastructure|@prisma\/client|from "next|next\/|server-only|stripe|resend|twilio/i);
  });

  it("the Prisma context reader is read-only and selects no contact / free-text / payment column", () => {
    const f = "src/core/infrastructure/database/prisma/repositories/prisma-lead-notification-context-reader.ts";
    const src = code(f);
    expect(src).not.toMatch(/\.(create|update|upsert|delete|deleteMany|updateMany|createMany)\(/);
    expect(src).not.toMatch(/\b(phone|email|name|title|description|line1|line2|postalCode|paymentReference|financialSnapshot|price|totalAmount|taxAmount)\b/);
    expect(src).toMatch(/LEAD_FLOW_VERSION/);
  });
});

describe("M145 event ownership — only authoritative boundaries raise the events", () => {
  const raisers = (needle: RegExp) => SRC.filter((f) => needle.test(code(f)) && !f.startsWith("src/core/domain/events/"));

  it("LeadPublished is constructed only by PublishLeadUseCase", () => {
    expect(raisers(/new LeadPublished\(/)).toEqual(["src/core/application/use-cases/lead/publish-lead.use-case.ts"]);
  });

  it("LeadPurchaseConfirmed / LeadPurchaseCancelled are constructed only by the M141 webhook use case", () => {
    const only = ["src/core/application/use-cases/lead-fee-payment/process-lead-fee-payment-webhook.use-case.ts"];
    expect(raisers(/new LeadPurchaseConfirmed\(/)).toEqual(only);
    expect(raisers(/new LeadPurchaseCancelled\(/)).toEqual(only);
  });

  it("no page, component, Server Action or route handler references the lead events, subscribers or the idempotent writer", () => {
    const ui = SRC.filter((f) => f.startsWith("src/app/") || f.startsWith("src/presentation/"));
    const offenders = ui.filter((f) =>
      /LeadPublished|LeadPurchaseConfirmed|LeadPurchaseCancelled|Notify(LeadPublished|LeadPurchase)|lead-notification|createIfAbsent|CreateIdempotentNotification|makeCreateIdempotentNotificationUseCase/.test(code(f)),
    );
    expect(offenders).toEqual([]);
  });

  it("the legacy customer-payment webhook use case and its composition know nothing about lead notifications", () => {
    for (const f of ["src/core/application/use-cases/payments/process-customer-payment-webhook.use-case.ts", "src/core/application/use-cases/payments/compose.ts"]) {
      expect(code(f)).not.toMatch(/lead-?notification|LeadPublished|LeadPurchase(Confirmed|Cancelled)|NotifyLead|lead-fee-payment/i);
    }
  });

  it("no second webhook handler: the only Stripe payments route still dispatches lead-fee events to the single M141 use case", () => {
    const routes = SRC.filter((f) => /^src\/app\/api\/webhooks\/.*route\.ts$/.test(f));
    const leadFeeRoutes = routes.filter((f) => /makeProcessLeadFeePaymentWebhookUseCase/.test(code(f)));
    expect(leadFeeRoutes).toEqual(["src/app/api/webhooks/stripe-payments/route.ts"]);
  });

  it("the checkout / payment-initiation Server Actions do not publish events or notify (the browser is never an event source)", () => {
    for (const f of SRC.filter((x) => /^src\/app\/\(dashboard\)\/dashboard\/professional\/leads\/.*(actions|payment-actions)\.ts$/.test(x))) {
      expect(code(f)).not.toMatch(/eventBus|\.publish\(|notify\(|NotificationCreator|NotificationService/);
    }
  });

  it("the composition roots attach the shared event bus to exactly the two raisers", () => {
    expect(code("src/core/application/use-cases/lead-fee-payment/compose.ts")).toMatch(/new PrismaExternalWebhookEventRepository\(\),\s*eventBus,/);
    expect(code("src/core/application/use-cases/lead-publication/compose.ts")).toMatch(/buyerPolicy,\s*eventBus,/);
    // the trusted lifecycle composition (M137) stays unchanged: it knows nothing about notifications
    expect(code("src/core/application/use-cases/lead-purchase/compose.ts")).not.toMatch(/eventBus|notification/i);
  });

  it("the three subscribers are registered on the shared bus, after all pre-existing registrations", () => {
    const src = code("src/core/application/use-cases/notification/compose.ts");
    const order = ["ReviewResponseAdded, new", "LeadPublished, new", "LeadPurchaseConfirmed,", "LeadPurchaseCancelled,"].map((needle) => src.indexOf(needle));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

describe("M145 privacy by construction", () => {
  it("lead notifications never request EMAIL / SMS / WEB_PUSH and send no resource ids", () => {
    const src = code("src/core/application/use-cases/notification/lead-notification-sender.ts");
    expect(src).toMatch(/channels: \["IN_APP", "REALTIME"\]/);
    expect(src).not.toMatch(/"EMAIL"|"SMS"|"WEB_PUSH"|email:|phone:/);
    expect(src).toMatch(/resourceType: null/);
    expect(src).toMatch(/resourceId: null/);
  });

  it("the notification content builders never reference contact, payment or purchase values", () => {
    for (const f of ["src/core/application/use-cases/notification/lead-notification-sender.ts", "src/core/domain/services/lead-notification.ts"]) {
      const body = code(f).replace(/^import .*$/gm, "");
      expect(body).not.toMatch(/paymentReference|paymentIntent|clientSecret|financialSnapshot|\.price\b|totalAmount|contactEmail|contactPhone|\bphone\b|postalCode|line1/);
    }
  });

  it("subscribers take recipients from the context reader, never from the event payload", () => {
    for (const f of SUBSCRIBERS.filter((x) => x.endsWith(".subscriber.ts"))) {
      expect(code(f)).not.toMatch(/event\.(userId|customerUserId|professionalUserId|recipient|email)/);
      expect(code(f)).toMatch(/recipientUserId: context\./);
    }
  });
});

describe("M145 schema + migration are additive and DB-enforced", () => {
  const dir = "prisma/migrations/20261011000000_add_module_145_lead_notifications";
  const sql = () => read(`${dir}/migration.sql`);
  const sqlCode = () => sql().replace(/^--.*$/gm, "");

  it("adds only four enum values, one nullable column and one unique index — nothing is dropped, renamed or rewritten", () => {
    const statements = sqlCode().split(";").map((s) => s.trim()).filter(Boolean);
    expect(statements).toEqual([
      `ALTER TYPE "NotificationType" ADD VALUE 'LEAD_REQUEST_PUBLISHED'`,
      `ALTER TYPE "NotificationType" ADD VALUE 'LEAD_PURCHASED'`,
      `ALTER TYPE "NotificationType" ADD VALUE 'LEAD_PURCHASE_CONFIRMED'`,
      `ALTER TYPE "NotificationType" ADD VALUE 'LEAD_PURCHASE_CANCELLED'`,
      `ALTER TABLE "notifications" ADD COLUMN "dedupeKey" VARCHAR(191)`,
      `CREATE UNIQUE INDEX "notifications_userId_dedupeKey_key" ON "notifications"("userId", "dedupeKey")`,
    ]);
    expect(sqlCode()).not.toMatch(/DROP|RENAME|DELETE|UPDATE|TRUNCATE|NOT NULL/i);
  });

  it("the Prisma schema declares the nullable key and the (userId, dedupeKey) unique constraint", () => {
    const schema = read("prisma/schema.prisma");
    const model = /model Notification \{([\s\S]*?)\n\}/.exec(schema)?.[1] ?? "";
    expect(model).toMatch(/dedupeKey\s+String\?\s+@db\.VarChar\(191\)/);
    expect(model).toMatch(/@@unique\(\[userId, dedupeKey\]\)/);
    const enumBody = /enum NotificationType \{([\s\S]*?)\n\}/.exec(schema)?.[1] ?? "";
    for (const v of ["LEAD_REQUEST_PUBLISHED", "LEAD_PURCHASED", "LEAD_PURCHASE_CONFIRMED", "LEAD_PURCHASE_CANCELLED"]) expect(enumBody).toContain(v);
  });

  it("the key never leaves the persistence layer: not selected back, not on the record type, not in the DTO schema", () => {
    expect(code("src/core/infrastructure/database/prisma/repositories/prisma-notification-repository.ts")).not.toMatch(/dedupeKey:\s*true|dedupeKey: row\./);
    expect(code("src/core/application/dto/notification.dto.ts")).not.toMatch(/dedupeKey/);
    const record = /export interface NotificationRecord \{([\s\S]*?)\n\}/.exec(read("src/core/domain/repositories/notification-repository.ts"))?.[1] ?? "";
    expect(record).not.toMatch(/dedupeKey/);
  });

  it("no pre-existing migration was modified (M145's migration exists and only LATER modules' migrations follow it)", () => {
    const dirs = readdirSync(path.join(root, "prisma/migrations")).filter((n) => /^\d{14}_/.test(n)).sort();
    const index = dirs.indexOf("20261011000000_add_module_145_lead_notifications");
    expect(index).toBeGreaterThanOrEqual(0);
    // Updated by Module 146: a newer migration may follow, but only one that belongs to a later module.
    for (const later of dirs.slice(index + 1)) expect(later).toMatch(/_add_module_(14[6-9]|1[5-9]\d)_/);
  });
});
