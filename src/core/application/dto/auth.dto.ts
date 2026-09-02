import { z } from "zod";

/**
 * Shared between client Form components (via @hookform/resolvers/zod) and
 * the Server Actions that receive the submission — validating only on the
 * client is not real validation, so every action re-parses with these
 * same schemas.
 */

const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address.");

// Deliberately not "just min(8)" — a length-only rule is weak. Still
// avoids being so strict it rejects legitimate passphrases.
const passwordSchema = z
  .string()
  .min(10, "Password must be at least 10 characters.")
  .max(128, "Password is too long.")
  .regex(/[a-z]/, "Password must include a lowercase letter.")
  .regex(/[A-Z]/, "Password must include an uppercase letter.")
  .regex(/[0-9]/, "Password must include a number.");

export const registerSchema = z
  .object({
    name: z.string().trim().min(2, "Enter your name.").max(100),
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
    // Professional Onboarding: set only when the "Soy profesional" CTA
    // carried `?intent=professional` through to this form (see
    // register-form.tsx/page.tsx) — a pure routing hint (see
    // SignupIntent's own doc comment in schema.prisma), never a role and
    // never validated against anything else in this schema. Defaults to
    // "CUSTOMER" so every other registration path is completely unchanged.
    intent: z.enum(["CUSTOMER", "PROFESSIONAL"]).optional().default("CUSTOMER"),
    // Module 60 — Referral & Marketing Attribution Platform: the opaque,
    // client-generated/cookie-stored visitor id (see docs/MODULE_60's
    // "Visitor identity" section) — present whenever the registration form
    // was loaded with the tracking cookie already set, absent for any
    // registration that never went through visit tracking (e.g. no
    // JavaScript, cookie blocked, or the visitor came from a client that
    // never called the tracking endpoint). Never validated against
    // anything else in this schema — a missing/unknown visitorId simply
    // means the registration goes unattributed, never a validation error.
    visitorId: z.string().trim().min(1).max(100).optional(),
    // Module 93 — Real Fraud & Trust Signal Providers: opaque
    // client-collected device signal, if any (e.g. `{ requestId }` from a
    // FingerprintJS Pro JS agent, when one is present in a future frontend
    // change — see FingerprintJsDeviceFingerprintProvider's own doc comment;
    // no such agent exists in this codebase's frontend today, so this is
    // always absent until that follow-up ships). Never validated against a
    // fixed shape here — `DeviceFingerprintProvider.fingerprint` already
    // treats its `rawSignal` argument as fully opaque (see that port's own
    // doc comment) and degrades gracefully for any shape, including this
    // field's total absence.
    deviceSignal: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password."),
  rememberMe: z.boolean().optional().default(false),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    token: z.string().min(1),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const verifyEmailSchema = z.object({
  token: z.string().min(1),
});
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
