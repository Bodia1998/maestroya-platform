import { beforeEach, describe, expect, it } from "vitest";

import { RegisterUserUseCase } from "@/application/use-cases/auth/register-user.use-case";
import { LinkRegistrationAttributionUseCase } from "@/application/use-cases/referral/link-registration-attribution.use-case";
import type { RegistrationAttributionLinker } from "@/application/ports/registration-attribution-linker";
import { FakeAuthTokenRepository, FakeEmailSender, FakeUserRepository } from "../auth/fakes";
import { FakeMarketingAttributionRepository } from "./fakes";

/**
 * Integration test for Module 60's extension of `RegisterUserUseCase`:
 * registration must link a tracked visitor's attribution record when a
 * `visitorId` is supplied, and must never fail registration when the
 * linker itself throws.
 */
describe("Module 60 — registration attribution linking", () => {
  let users: FakeUserRepository;
  let tokens: FakeAuthTokenRepository;
  let emails: FakeEmailSender;
  let attributions: FakeMarketingAttributionRepository;

  beforeEach(() => {
    users = new FakeUserRepository();
    tokens = new FakeAuthTokenRepository();
    emails = new FakeEmailSender();
    attributions = new FakeMarketingAttributionRepository();
  });

  it("links the new user to an existing tracked visitor's attribution", async () => {
    await attributions.upsertTouchState("visitor-tracked", {
      firstSource: "TELEGRAM",
      firstCampaign: null,
      firstReferralCode: "telegram_valencia",
      firstVisitAt: new Date(),
      lastSource: "TELEGRAM",
      lastCampaign: null,
      lastReferralCode: "telegram_valencia",
      lastVisitAt: new Date(),
    });

    const linker = new LinkRegistrationAttributionUseCase(attributions);
    const register = new RegisterUserUseCase(users, tokens, emails, linker);

    const { userId } = await register.execute({
      name: "Ana García",
      email: "ana-attributed@example.com",
      password: "GoodPass123",
      confirmPassword: "GoodPass123",
      intent: "CUSTOMER",
      visitorId: "visitor-tracked",
    });

    const attribution = await attributions.findByVisitorId("visitor-tracked");
    expect(attribution?.userId).toBe(userId);
  });

  it("does not break registration when no attributionLinker is provided", async () => {
    const register = new RegisterUserUseCase(users, tokens, emails);

    await expect(
      register.execute({
        name: "Ana",
        email: "ana-no-linker@example.com",
        password: "GoodPass123",
        confirmPassword: "GoodPass123",
        intent: "CUSTOMER",
        visitorId: "visitor-x",
      }),
    ).resolves.toMatchObject({ userId: expect.any(String) });
  });

  it("does not break registration when the attributionLinker throws", async () => {
    const throwingLinker: RegistrationAttributionLinker = {
      linkRegistration: async () => {
        throw new Error("attribution backend is down");
      },
    };
    const register = new RegisterUserUseCase(users, tokens, emails, throwingLinker);

    const { userId } = await register.execute({
      name: "Ana",
      email: "ana-broken-linker@example.com",
      password: "GoodPass123",
      confirmPassword: "GoodPass123",
      intent: "CUSTOMER",
      visitorId: "visitor-y",
    });

    expect(userId).toBeTruthy();
    const user = await users.findById(userId);
    expect(user).not.toBeNull();
  });

  it("does not attempt to link when no visitorId is supplied", async () => {
    let called = false;
    const spyLinker: RegistrationAttributionLinker = {
      linkRegistration: async () => {
        called = true;
      },
    };
    const register = new RegisterUserUseCase(users, tokens, emails, spyLinker);

    await register.execute({
      name: "Ana",
      email: "ana-no-visitor@example.com",
      password: "GoodPass123",
      confirmPassword: "GoodPass123",
      intent: "CUSTOMER",
    });

    expect(called).toBe(false);
  });
});
