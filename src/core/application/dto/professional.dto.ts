import { z } from "zod";

import { addressSchema } from "./profile.dto";

/**
 * Same convention as profile.dto.ts: one schema shared by the client form
 * (via @hookform/resolvers/zod) and the Server Action that receives it.
 *
 * Deliberately absent from every schema here: `status` and
 * `verificationStatus`. Status changes go through their own dedicated
 * action (deactivate), and verificationStatus is admin-only and never
 * settable by a professional-facing form — see UpdateProfessionalUseCase
 * and DeactivateProfessionalUseCase.
 */

const optionalTrimmed = (max: number) =>
  z.string().trim().max(max).optional().or(z.literal(""));

export const createProfessionalSchema = z.object({
  businessName: optionalTrimmed(150),
  headline: optionalTrimmed(150),
  bio: z.string().trim().max(2000).optional().or(z.literal("")),
  yearsExperience: z
    .coerce.number()
    .int("Enter a whole number.")
    .min(0, "Years of experience cannot be negative.")
    .max(80, "Enter a realistic number of years.")
    .optional(),
  hourlyRate: z
    .coerce.number()
    .min(0, "Hourly rate cannot be negative.")
    .max(100000, "Enter a realistic hourly rate.")
    .optional(),
  serviceRadiusKm: z
    .coerce.number()
    .int("Enter a whole number.")
    .min(0, "Service radius cannot be negative.")
    .max(1000, "Enter a realistic service radius.")
    .optional(),
  contactEmail: z.string().trim().toLowerCase().email("Enter a valid email address.").optional().or(z.literal("")),
  contactPhone: z
    .string()
    .trim()
    .regex(/^\+?[0-9\s-]{7,20}$/, "Enter a valid phone number.")
    .optional()
    .or(z.literal("")),
  websiteUrl: z.string().trim().url("Enter a valid URL.").optional().or(z.literal("")),
  taxId: optionalTrimmed(50),
  categoryIds: z.array(z.string().uuid()).max(20, "Select up to 20 categories.").optional(),
});
export type CreateProfessionalInput = z.infer<typeof createProfessionalSchema>;

// Update reuses the same field-level rules as create — a professional can
// change any of the same business/contact/experience fields after
// creation — but omits categoryIds, which has its own dedicated schema
// below (UpdateProfessionalServicesUseCase) since it is a distinct action.
export const updateProfessionalSchema = createProfessionalSchema
  .omit({ categoryIds: true })
  .extend({
    isAcceptingRequests: z.boolean().optional(),
  });
export type UpdateProfessionalInput = z.infer<typeof updateProfessionalSchema>;

export const updateProfessionalServicesSchema = z.object({
  categoryIds: z
    .array(z.string().uuid())
    .min(1, "Select at least one service category.")
    .max(20, "Select up to 20 categories."),
});
export type UpdateProfessionalServicesInput = z.infer<typeof updateProfessionalServicesSchema>;

/**
 * Professional Onboarding — a dedicated, *stricter* schema, not a variant
 * of `createProfessionalSchema` (create leaves everything but
 * `categoryIds` optional, since an existing professional's dashboard form
 * has to also handle "leave this blank"). Onboarding is a one-time,
 * required-fields flow: primary profession/category, phone, base
 * location, service radius, and a short description are all mandatory —
 * see docs for the product requirement. `categoryIds` reuses
 * `updateProfessionalServicesSchema`'s exact field (same min/max rules,
 * one definition) and `address` reuses the Profile module's own
 * `addressSchema` (same rules a "base location" already needs elsewhere)
 * rather than introducing a second, free-text "service area" field — see
 * docs/MODULE_20_MAPS_GEOLOCATION.md: the matching system uses
 * coordinates (resolved from this address) plus `serviceRadiusKm`, never
 * a free-text area description.
 */
export const professionalOnboardingSchema = z.object({
  categoryIds: updateProfessionalServicesSchema.shape.categoryIds,
  contactPhone: z
    .string()
    .trim()
    .regex(/^\+?[0-9\s-]{7,20}$/, "Enter a valid phone number."),
  bio: z.string().trim().min(1, "Add a short description.").max(2000),
  serviceRadiusKm: z
    .coerce.number()
    .int("Enter a whole number.")
    .min(0, "Service radius cannot be negative.")
    .max(1000, "Enter a realistic service radius."),
  address: addressSchema,
});
export type ProfessionalOnboardingInput = z.infer<typeof professionalOnboardingSchema>;

export const deactivateProfessionalSchema = z.object({
  confirmationText: z.literal("DEACTIVATE", {
    errorMap: () => ({ message: 'Type "DEACTIVATE" to confirm.' }),
  }),
});
export type DeactivateProfessionalInput = z.infer<typeof deactivateProfessionalSchema>;
