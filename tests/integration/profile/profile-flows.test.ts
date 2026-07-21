import { beforeEach, describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "@/infrastructure/auth/password";
import { ChangePasswordUseCase } from "@/application/use-cases/profile/change-password.use-case";
import { DeleteAccountUseCase } from "@/application/use-cases/profile/delete-account.use-case";
import { GetProfileUseCase } from "@/application/use-cases/profile/get-profile.use-case";
import { UpdateProfileUseCase } from "@/application/use-cases/profile/update-profile.use-case";
import { UploadAvatarUseCase } from "@/application/use-cases/profile/upload-avatar.use-case";
import { FakeAuthTokenRepository, FakeUserRepository } from "../auth/fakes";
import { FakeAddressRepository, FakeAvatarUploadService } from "./fakes";

async function seedUser(users: FakeUserRepository, password = "OldPassword1") {
  const passwordHash = await hashPassword(password);
  return users.createWithPassword({ email: "ana@example.com", name: "Ana", passwordHash });
}

describe("GetProfileUseCase", () => {
  it("returns the profile and primary address", async () => {
    const users = new FakeUserRepository();
    const addresses = new FakeAddressRepository();
    const user = await seedUser(users);
    await addresses.upsertPrimaryForUser(user.id, {
      line1: "Calle Mayor 1",
      city: "Gandia",
      postalCode: "46700",
      country: "ES",
    });

    const result = await new GetProfileUseCase(users, addresses).execute(user.id);

    expect(result.profile.id).toBe(user.id);
    expect(result.address?.city).toBe("Gandia");
  });

  it("throws NotFoundError for an unknown user", async () => {
    const users = new FakeUserRepository();
    const addresses = new FakeAddressRepository();
    await expect(new GetProfileUseCase(users, addresses).execute("nope")).rejects.toThrow();
  });
});

describe("UpdateProfileUseCase", () => {
  it("updates profile fields and upserts the address when provided", async () => {
    const users = new FakeUserRepository();
    const addresses = new FakeAddressRepository();
    const user = await seedUser(users);

    await new UpdateProfileUseCase(users, addresses).execute(user.id, {
      name: "Ana García",
      preferredLanguageId: null,
      phone: "+34600000000",
      timezone: "Europe/Madrid",
      address: {
        line1: "Calle Mayor 1",
        city: "Gandia",
        postalCode: "46700",
        country: "ES",
      },
    });

    const profile = await users.findProfileById(user.id);
    expect(profile?.name).toBe("Ana García");

    const address = await addresses.findPrimaryByUserId(user.id);
    expect(address?.city).toBe("Gandia");
  });

  it("does not touch the address when none is provided", async () => {
    const users = new FakeUserRepository();
    const addresses = new FakeAddressRepository();
    const user = await seedUser(users);

    await new UpdateProfileUseCase(users, addresses).execute(user.id, { name: "Solo Name", preferredLanguageId: null });

    expect(await addresses.findPrimaryByUserId(user.id)).toBeNull();
  });
});

describe("UploadAvatarUseCase", () => {
  it("uploads via the avatar service and stores the returned URL on the user", async () => {
    const users = new FakeUserRepository();
    const avatarService = new FakeAvatarUploadService();
    const user = await seedUser(users);

    const url = await new UploadAvatarUseCase(users, avatarService).execute(
      user.id,
      Buffer.from("fake-image-bytes"),
      "image/png",
    );

    expect(url).toContain(user.id);
    expect(avatarService.uploads).toHaveLength(1);
    expect(avatarService.uploads[0]?.contentType).toBe("image/png");
  });
});

describe("ChangePasswordUseCase", () => {
  let users: FakeUserRepository;
  let tokens: FakeAuthTokenRepository;

  beforeEach(() => {
    users = new FakeUserRepository();
    tokens = new FakeAuthTokenRepository();
  });

  it("changes the password when the current password is correct", async () => {
    const user = await seedUser(users, "OldPassword1");

    await new ChangePasswordUseCase(users, tokens).execute(user.id, "OldPassword1", "NewPassword2");

    const updated = await users.findById(user.id);
    await expect(verifyPassword("NewPassword2", updated!.passwordHash!)).resolves.toBe(true);
    await expect(verifyPassword("OldPassword1", updated!.passwordHash!)).resolves.toBe(false);
  });

  it("rejects an incorrect current password", async () => {
    const user = await seedUser(users, "OldPassword1");

    await expect(
      new ChangePasswordUseCase(users, tokens).execute(user.id, "WrongPassword", "NewPassword2"),
    ).rejects.toThrow();
  });

  it("revokes all refresh tokens on successful change", async () => {
    const user = await seedUser(users, "OldPassword1");
    await tokens.createRefreshToken({
      userId: user.id,
      tokenHash: "session-a",
      expiresAt: new Date(Date.now() + 100000),
    });

    await new ChangePasswordUseCase(users, tokens).execute(user.id, "OldPassword1", "NewPassword2");

    expect(await tokens.findValidRefreshToken("session-a")).toBeNull();
  });
});

describe("DeleteAccountUseCase", () => {
  let users: FakeUserRepository;
  let tokens: FakeAuthTokenRepository;

  beforeEach(() => {
    users = new FakeUserRepository();
    tokens = new FakeAuthTokenRepository();
  });

  it("soft-deletes the account when the password is correct", async () => {
    const user = await seedUser(users, "OldPassword1");

    await new DeleteAccountUseCase(users, tokens).execute(user.id, "OldPassword1");

    const updated = await users.findById(user.id);
    expect(updated?.status).toBe("DEACTIVATED");
  });

  it("rejects an incorrect password and does not delete the account", async () => {
    const user = await seedUser(users, "OldPassword1");

    await expect(
      new DeleteAccountUseCase(users, tokens).execute(user.id, "WrongPassword"),
    ).rejects.toThrow();

    const updated = await users.findById(user.id);
    expect(updated?.status).not.toBe("DEACTIVATED");
  });

  it("revokes all refresh tokens on deletion", async () => {
    const user = await seedUser(users, "OldPassword1");
    await tokens.createRefreshToken({
      userId: user.id,
      tokenHash: "session-a",
      expiresAt: new Date(Date.now() + 100000),
    });

    await new DeleteAccountUseCase(users, tokens).execute(user.id, "OldPassword1");

    expect(await tokens.findValidRefreshToken("session-a")).toBeNull();
  });

  it("deletes an OAuth-only account (no passwordHash) with no password argument at all", async () => {
    const oauthUser = await users.createWithPassword({
      email: "oauth@example.com",
      name: "OAuth User",
      passwordHash: "",
    });
    // Simulate an OAuth-only account the way the real repository would
    // represent one: passwordHash is null, not an empty string.
    users.users.get(oauthUser.id)!.passwordHash = null;

    await new DeleteAccountUseCase(users, tokens).execute(oauthUser.id);

    const updated = await users.findById(oauthUser.id);
    expect(updated?.status).toBe("DEACTIVATED");
  });

  it("rejects a password-based account deletion attempt with no password given", async () => {
    const user = await seedUser(users, "OldPassword1");

    await expect(new DeleteAccountUseCase(users, tokens).execute(user.id)).rejects.toThrow();

    const updated = await users.findById(user.id);
    expect(updated?.status).not.toBe("DEACTIVATED");
  });
});
