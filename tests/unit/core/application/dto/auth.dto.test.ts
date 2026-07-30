import { describe, expect, it } from "vitest";

import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from "@/core/application/dto/auth.dto";

describe("registerSchema", () => {
  const valid = {
    name: "Ana García",
    email: "ana@example.com",
    password: "GoodPass123",
    confirmPassword: "GoodPass123",
  };

  it("accepts a valid registration", () => {
    expect(registerSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects mismatched passwords", () => {
    const result = registerSchema.safeParse({ ...valid, confirmPassword: "Different123" });
    expect(result.success).toBe(false);
  });

  it("rejects a password missing an uppercase letter", () => {
    const result = registerSchema.safeParse({
      ...valid,
      password: "lowercase123",
      confirmPassword: "lowercase123",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a password under 10 characters", () => {
    const result = registerSchema.safeParse({
      ...valid,
      password: "Short1",
      confirmPassword: "Short1",
    });
    expect(result.success).toBe(false);
  });

  it("lowercases and trims email", () => {
    const result = registerSchema.safeParse({ ...valid, email: "  Ana@Example.com  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("ana@example.com");
    }
  });

  it("rejects an invalid email", () => {
    expect(registerSchema.safeParse({ ...valid, email: "not-an-email" }).success).toBe(false);
  });

  /**
   * Professional Onboarding: `intent` is a pure routing hint (see
   * SignupIntent's own doc comment in schema.prisma), not a role — these
   * cases guard that registering without it (every pre-existing caller)
   * keeps behaving exactly as before, defaulting to CUSTOMER.
   */
  describe("intent (Professional Onboarding routing hint)", () => {
    it("defaults to CUSTOMER when omitted, so ordinary registration is unaffected", () => {
      const result = registerSchema.safeParse(valid);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.intent).toBe("CUSTOMER");
      }
    });

    it("accepts an explicit PROFESSIONAL intent", () => {
      const result = registerSchema.safeParse({ ...valid, intent: "PROFESSIONAL" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.intent).toBe("PROFESSIONAL");
      }
    });

    it("rejects an intent value outside the two allowed enum members", () => {
      const result = registerSchema.safeParse({ ...valid, intent: "ADMIN" });
      expect(result.success).toBe(false);
    });
  });
});

describe("loginSchema", () => {
  it("defaults rememberMe to false when omitted", () => {
    const result = loginSchema.safeParse({ email: "a@b.com", password: "x" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.rememberMe).toBe(false);
    }
  });

  it("rejects an empty password", () => {
    expect(loginSchema.safeParse({ email: "a@b.com", password: "" }).success).toBe(false);
  });
});

describe("forgotPasswordSchema", () => {
  it("rejects an invalid email", () => {
    expect(forgotPasswordSchema.safeParse({ email: "nope" }).success).toBe(false);
  });
});

describe("resetPasswordSchema", () => {
  it("rejects mismatched passwords", () => {
    const result = resetPasswordSchema.safeParse({
      token: "abc",
      password: "GoodPass123",
      confirmPassword: "Different123",
    });
    expect(result.success).toBe(false);
  });

  it("accepts matching strong passwords with a token", () => {
    const result = resetPasswordSchema.safeParse({
      token: "abc",
      password: "GoodPass123",
      confirmPassword: "GoodPass123",
    });
    expect(result.success).toBe(true);
  });
});
