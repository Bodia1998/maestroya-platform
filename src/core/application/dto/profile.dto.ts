import { z } from "zod";

/**
 * Same convention as auth.dto.ts: one schema shared by the client form
 * (via @hookform/resolvers/zod) and the Server Action that receives it.
 */

/**
 * Shared with the avatar upload Server Action and the Cloudinary
 * implementation — one source of truth instead of three copies of the
 * same allowlist/size limit that could drift out of sync.
 */
export const ALLOWED_AVATAR_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5MB

const addressSchema = z.object({
  line1: z.string().trim().min(1, "Enter a street address.").max(200),
  line2: z.string().trim().max(200).optional().or(z.literal("")),
  city: z.string().trim().min(1, "Enter a city.").max(100),
  province: z.string().trim().max(100).optional().or(z.literal("")),
  postalCode: z.string().trim().min(1, "Enter a postal code.").max(20),
  country: z.string().trim().min(2, "Enter a country.").max(100).default("ES"),
});

export const updateProfileSchema = z.object({
  name: z.string().trim().min(2, "Enter your name.").max(100),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9\s-]{7,20}$/, "Enter a valid phone number.")
    .optional()
    .or(z.literal("")),
  timezone: z.string().trim().min(1, "Select a timezone.").max(100).optional(),
  // Empty string ("No preference" option) explicitly clears the
  // preference (-> null) rather than being rejected as an invalid UUID —
  // preferredLanguageId is nullable on User, so the form must be able to
  // represent "no preference", not just "leave unchanged".
  preferredLanguageId: z
    .string()
    .uuid()
    .optional()
    .or(z.literal(""))
    .transform((value) => (value ? value : null)),
  address: addressSchema.optional(),
  notificationPreferences: z
    .object({
      emailMarketing: z.boolean().default(true),
      emailServiceUpdates: z.boolean().default(true),
      smsAppointmentReminders: z.boolean().default(true),
    })
    .optional(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password."),
    newPassword: z
      .string()
      .min(10, "Password must be at least 10 characters.")
      .max(128, "Password is too long.")
      .regex(/[a-z]/, "Password must include a lowercase letter.")
      .regex(/[A-Z]/, "Password must include an uppercase letter.")
      .regex(/[0-9]/, "Password must include a number."),
    confirmNewPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmNewPassword, {
    message: "Passwords do not match.",
    path: ["confirmNewPassword"],
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: "New password must be different from your current password.",
    path: ["newPassword"],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const deleteAccountSchema = z.object({
  // Optional at the DTO level deliberately — OAuth-only accounts have no
  // password to enter. DeleteAccountUseCase enforces "required if this
  // account actually has a password", since only it knows that.
  password: z.string().optional(),
  confirmationText: z.literal("DELETE", {
    errorMap: () => ({ message: 'Type "DELETE" to confirm.' }),
  }),
});
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;
