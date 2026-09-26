import { describe, expect, it, vi } from "vitest";

import type { EmailSender } from "@/application/interfaces/email-sender";
import { EmailNotificationChannel } from "@/infrastructure/notifications/channels/email-notification-channel";
import { RecipientNotificationLocalizer } from "@/infrastructure/notifications/recipient-notification-localizer";
import type { Locale } from "@/shared/i18n/locales";

/** Module 120 — out-of-band notifications render in the recipient's language. */

const payload = {
  userId: "user-1",
  email: "ana@example.com",
  category: "INFORMATION" as const,
  type: "QUOTE_ACCEPTED" as const,
  title: "Your quote was accepted",
  message: "The customer accepted your quote.",
  actionUrl: "/jobs/1",
};

function localizer(preferred: Locale | null | Error) {
  return new RecipientNotificationLocalizer({
    execute: vi.fn(async () => {
      if (preferred instanceof Error) throw preferred;
      return preferred;
    }),
  });
}

describe("RecipientNotificationLocalizer", () => {
  it("uses the recipient's preferred locale", async () => {
    await expect(localizer("ru").localize(payload)).resolves.toEqual({
      locale: "ru",
      title: "Ваша смета принята",
      message: "Клиент принял вашу смету.",
    });
  });

  it("prefers an explicit payload locale, and falls back to Spanish without a preference or on lookup failure", async () => {
    expect((await localizer("ru").localize({ ...payload, locale: "nl" })).locale).toBe("nl");
    expect((await localizer(null).localize(payload)).title).toBe("Han aceptado tu presupuesto");
    expect((await localizer(new Error("db down")).localize(payload)).locale).toBe("es");
  });
});

describe("EmailNotificationChannel with a localizer", () => {
  it("sends subject and body in the recipient's language", async () => {
    const send = vi.fn(async () => undefined);
    const channel = new EmailNotificationChannel({ send } as unknown as EmailSender, localizer("nl"));
    await channel.send(payload);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "ana@example.com",
        subject: "Je offerte is geaccepteerd",
        html: expect.stringContaining("De klant heeft je offerte geaccepteerd."),
      }),
    );
  });
});
