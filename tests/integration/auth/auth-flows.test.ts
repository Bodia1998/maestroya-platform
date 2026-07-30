import { beforeEach, describe, expect, it } from "vitest";

import { verifyPassword } from "@/core/infrastructure/auth/password";
import { RegisterUserUseCase } from "@/core/application/use-cases/auth/register-user.use-case";
import { RequestPasswordResetUseCase } from "@/core/application/use-cases/auth/request-password-reset.use-case";
import { ResetPasswordUseCase } from "@/core/application/use-cases/auth/reset-password.use-case";
import { VerifyEmailUseCase } from "@/core/application/use-cases/auth/verify-email.use-case";
import { FakeAuthTokenRepository, FakeEmailSender, FakeUserRepository } from "./fakes";

function extractToken(html: string): string {
  const match = html.match(/token=([^"&\s]+)/);
  const token = match?.[1];
  if (!token) throw new Error("No token found in email HTML");
  return token;
}

/** Safe accessor for the fake mailbox — throws with a clear message instead of an unchecked index. */
function lastSentEmail(emails: FakeEmailSender) {
  const email = emails.sent.at(-1);
  if (!email) throw new Error("Expected an email to have been sent, but none was.");
  return email;
}

describe("Authentication integration: register -> verify email", () => {
  let users: FakeUserRepository;
  let tokens: FakeAuthTokenRepository;
  let emails: FakeEmailSender;

  beforeEach(() => {
    users = new FakeUserRepository();
    tokens = new FakeAuthTokenRepository();
    emails = new FakeEmailSender();
  });

  it("registers a user, hashes their password, assigns CUSTOMER, and sends a verification email", async () => {
    const register = new RegisterUserUseCase(users, tokens, emails);

    const { userId } = await register.execute({
      name: "Ana García",
      email: "ana@example.com",
      password: "GoodPass123",
      confirmPassword: "GoodPass123",
      intent: "CUSTOMER",
    });

    const user = await users.findById(userId);
    expect(user).not.toBeNull();
    expect(user!.passwordHash).not.toBe("GoodPass123");
    await expect(verifyPassword("GoodPass123", user!.passwordHash!)).resolves.toBe(true);
    expect(user!.emailVerified).toBeNull();

    expect(await users.getRoleKeys(userId)).toContain("CUSTOMER");
    expect(emails.sent).toHaveLength(1);
    expect(lastSentEmail(emails).to).toBe("ana@example.com");
  });

  it("rejects registering the same email twice", async () => {
    const register = new RegisterUserUseCase(users, tokens, emails);
    const input = {
      name: "Ana",
      email: "dupe@example.com",
      password: "GoodPass123",
      confirmPassword: "GoodPass123",
      intent: "CUSTOMER" as const,
    };

    await register.execute(input);
    await expect(register.execute(input)).rejects.toThrow();
  });

  it("verifies email with the emailed token and marks the account ACTIVE", async () => {
    const register = new RegisterUserUseCase(users, tokens, emails);
    const verify = new VerifyEmailUseCase(users, tokens);

    const { userId } = await register.execute({
      name: "Ana",
      email: "ana2@example.com",
      password: "GoodPass123",
      confirmPassword: "GoodPass123",
      intent: "CUSTOMER",
    });

    const rawToken = extractToken(lastSentEmail(emails).html);
    await verify.execute(rawToken);

    const user = await users.findById(userId);
    expect(user!.emailVerified).not.toBeNull();
    expect(user!.status).toBe("ACTIVE");
  });

  it("rejects an already-used or unknown verification token", async () => {
    const verify = new VerifyEmailUseCase(users, tokens);
    await expect(verify.execute("not-a-real-token")).rejects.toThrow();
  });
});

describe("Authentication integration: forgot password -> reset password", () => {
  let users: FakeUserRepository;
  let tokens: FakeAuthTokenRepository;
  let emails: FakeEmailSender;

  beforeEach(async () => {
    users = new FakeUserRepository();
    tokens = new FakeAuthTokenRepository();
    emails = new FakeEmailSender();

    const register = new RegisterUserUseCase(users, tokens, emails);
    await register.execute({
      name: "Ana",
      email: "ana@example.com",
      password: "OldPassword1",
      confirmPassword: "OldPassword1",
      intent: "CUSTOMER",
    });
    emails.sent = []; // clear the registration email so the reset test only sees its own
  });

  it("does not error and does not send an email for an unknown address (anti-enumeration)", async () => {
    const requestReset = new RequestPasswordResetUseCase(users, tokens, emails);
    await requestReset.execute("nobody@example.com");
    expect(emails.sent).toHaveLength(0);
  });

  it("sends a reset email for a known address with a password", async () => {
    const requestReset = new RequestPasswordResetUseCase(users, tokens, emails);
    await requestReset.execute("ana@example.com");
    expect(emails.sent).toHaveLength(1);
  });

  it("resets the password with a valid token, and the old password stops working", async () => {
    const requestReset = new RequestPasswordResetUseCase(users, tokens, emails);
    const resetPassword = new ResetPasswordUseCase(users, tokens);

    await requestReset.execute("ana@example.com");
    const rawToken = extractToken(lastSentEmail(emails).html);

    await resetPassword.execute(rawToken, "NewPassword2");

    const user = await users.findByEmail("ana@example.com");
    await expect(verifyPassword("OldPassword1", user!.passwordHash!)).resolves.toBe(false);
    await expect(verifyPassword("NewPassword2", user!.passwordHash!)).resolves.toBe(true);
  });

  it("rejects reusing the same reset token twice", async () => {
    const requestReset = new RequestPasswordResetUseCase(users, tokens, emails);
    const resetPassword = new ResetPasswordUseCase(users, tokens);

    await requestReset.execute("ana@example.com");
    const rawToken = extractToken(lastSentEmail(emails).html);

    await resetPassword.execute(rawToken, "NewPassword2");
    await expect(resetPassword.execute(rawToken, "AnotherPassword3")).rejects.toThrow();
  });

  it("revokes all refresh tokens on password reset", async () => {
    const requestReset = new RequestPasswordResetUseCase(users, tokens, emails);
    const resetPassword = new ResetPasswordUseCase(users, tokens);

    const user = await users.findByEmail("ana@example.com");
    await tokens.createRefreshToken({
      userId: user!.id,
      tokenHash: "some-refresh-hash",
      expiresAt: new Date(Date.now() + 100000),
    });
    expect(await tokens.findValidRefreshToken("some-refresh-hash")).not.toBeNull();

    await requestReset.execute("ana@example.com");
    const rawToken = extractToken(lastSentEmail(emails).html);
    await resetPassword.execute(rawToken, "NewPassword2");

    expect(await tokens.findValidRefreshToken("some-refresh-hash")).toBeNull();
  });
});
