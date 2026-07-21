import { describe, expect, it } from "vitest";

import {
  changePasswordSchema,
  deleteAccountSchema,
  updateProfileSchema,
} from "@/application/dto/profile.dto";

describe("updateProfileSchema", () => {
  it("accepts a minimal valid update (name only)", () => {
    expect(updateProfileSchema.safeParse({ name: "Ana" }).success).toBe(true);
  });

  it("rejects an invalid phone number", () => {
    const result = updateProfileSchema.safeParse({ name: "Ana", phone: "abc" });
    expect(result.success).toBe(false);
  });

  it("accepts a full update with address and notification preferences", () => {
    const result = updateProfileSchema.safeParse({
      name: "Ana",
      phone: "+34600000000",
      timezone: "Europe/Madrid",
      address: {
        line1: "Calle Mayor 1",
        city: "Gandia",
        postalCode: "46700",
        country: "ES",
      },
      notificationPreferences: {
        emailMarketing: false,
        emailServiceUpdates: true,
        smsAppointmentReminders: true,
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects an address missing a required field", () => {
    const result = updateProfileSchema.safeParse({
      name: "Ana",
      address: { city: "Gandia", postalCode: "46700", country: "ES" },
    });
    expect(result.success).toBe(false);
  });

  it("transforms an empty preferredLanguageId (the 'No preference' option) to null", () => {
    const result = updateProfileSchema.safeParse({ name: "Ana", preferredLanguageId: "" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.preferredLanguageId).toBeNull();
    }
  });

  it("passes through a valid preferredLanguageId UUID unchanged", () => {
    const uuid = "123e4567-e89b-12d3-a456-426614174000";
    const result = updateProfileSchema.safeParse({ name: "Ana", preferredLanguageId: uuid });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.preferredLanguageId).toBe(uuid);
    }
  });

  it("rejects a preferredLanguageId that is neither empty nor a valid UUID", () => {
    const result = updateProfileSchema.safeParse({ name: "Ana", preferredLanguageId: "not-a-uuid" });
    expect(result.success).toBe(false);
  });
});

describe("changePasswordSchema", () => {
  const valid = {
    currentPassword: "OldPassword1",
    newPassword: "NewPassword2",
    confirmNewPassword: "NewPassword2",
  };

  it("accepts a valid change", () => {
    expect(changePasswordSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects mismatched new passwords", () => {
    const result = changePasswordSchema.safeParse({
      ...valid,
      confirmNewPassword: "Different3",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a new password identical to the current password", () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: "SamePassword1",
      newPassword: "SamePassword1",
      confirmNewPassword: "SamePassword1",
    });
    expect(result.success).toBe(false);
  });
});

describe("deleteAccountSchema", () => {
  it("requires the literal confirmation text DELETE", () => {
    const result = deleteAccountSchema.safeParse({
      password: "x",
      confirmationText: "delete",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a correct confirmation", () => {
    const result = deleteAccountSchema.safeParse({
      password: "x",
      confirmationText: "DELETE",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a missing password (OAuth-only accounts have none to enter)", () => {
    const result = deleteAccountSchema.safeParse({ confirmationText: "DELETE" });
    expect(result.success).toBe(true);
  });
});
