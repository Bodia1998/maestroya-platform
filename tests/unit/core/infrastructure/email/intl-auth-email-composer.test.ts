import { describe, expect, it } from "vitest";

import { RequestPasswordResetUseCase } from "@/application/use-cases/auth/request-password-reset.use-case";
import { RegisterUserUseCase } from "@/application/use-cases/auth/register-user.use-case";
import { IntlAuthEmailComposer } from "@/infrastructure/email/intl-auth-email-composer";
import { buildSmsBody } from "@/infrastructure/sms/sms-template-mapping";
import { FakeAuthTokenRepository, FakeEmailSender, FakeUserRepository } from "../../../../integration/auth/fakes";

/** Module 120 — auth emails and SMS render in the recipient's language. */

const composer = new IntlAuthEmailComposer();
const URL = "http://localhost:3000/auth/verify-email?token=abc123";

describe("IntlAuthEmailComposer", () => {
  it("renders the verification email in the requested locale, keeping the link intact", () => {
    const email = composer.composeVerifyEmail({ locale: "ru", name: "Ана", actionUrl: URL, ttlMs: 24 * 3600 * 1000 });
    expect(email.subject).toBe("Подтвердите адрес электронной почты");
    expect(email.html).toContain(`href="${URL}"`);
    expect(email.html).toContain("Здравствуйте, Ана!");
    expect(email.html).toContain("Ссылка действительна 24 часа.");
  });

  it("falls back to Spanish for an unknown locale and escapes the user-supplied name", () => {
    const email = composer.composePasswordReset({ locale: "xx", name: "<b>Eve</b>", actionUrl: URL, ttlMs: 3600 * 1000 });
    expect(email.subject).toBe("Restablece tu contraseña");
    expect(email.html).toContain("&lt;b&gt;Eve&lt;/b&gt;");
    expect(email.html).not.toContain("<b>Eve</b>");
    expect(email.html).toContain("Este enlace caduca en 1 hora.");
  });
});

describe("auth use cases pick the recipient locale", () => {
  it("register: request locale, default Spanish", async () => {
    const users = new FakeUserRepository();
    const emails = new FakeEmailSender();
    const register = new RegisterUserUseCase(users, new FakeAuthTokenRepository(), emails);
    await register.execute({ email: "a@example.com", name: "Ana", password: "Password123" } as never, { locale: "nl" });
    await register.execute({ email: "b@example.com", name: "Bea", password: "Password123" } as never);
    expect(emails.sent.map((e) => e.subject)).toEqual(["Bevestig je e-mailadres", "Verifica tu dirección de correo"]);
  });

  it("reset: stored preferredLocale wins over the request locale; response unchanged for unknown emails", async () => {
    const users = new FakeUserRepository();
    const tokens = new FakeAuthTokenRepository();
    const emails = new FakeEmailSender();
    const { userId } = await new RegisterUserUseCase(users, tokens, emails).execute({
      email: "ana@example.com",
      name: "Ana",
      password: "Password123",
    } as never);
    emails.sent = [];
    const reset = new RequestPasswordResetUseCase(users, tokens, emails);

    await reset.execute("ana@example.com", { locale: "de" });
    await users.updatePreferredLocale(userId, "ru");
    await reset.execute("ana@example.com", { locale: "de" });
    await expect(reset.execute("nobody@example.com", { locale: "ru" })).resolves.toBeUndefined();

    expect(emails.sent.map((e) => e.subject)).toEqual(["Setze dein Passwort zurück", "Сброс пароля"]);
  });
});

describe("SMS templates for ru and nl", () => {
  it.each([
    ["ru", "По вашему заказу открыт спор (D-1001). MaestroYa"],
    ["nl", "Er is een geschil (D-1001) geopend over je opdracht. MaestroYa"],
  ])("renders the dispute SMS in %s", (locale, expected) => {
    const body = buildSmsBody({
      userId: "u1",
      phone: "+34600000000",
      type: "DISPUTE_CREATED",
      fallbackMessage: "A dispute (D-1001) was opened regarding your job.",
      locale,
      metadata: { caseNumber: "D-1001" },
    });
    expect(body).toBe(expected);
  });
});
