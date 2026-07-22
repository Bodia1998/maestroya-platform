import { z } from "zod";

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

export const deactivateProfessionalSchema = z.object({
  confirmationText: z.literal("DEACTIVATE", {
    errorMap: () => ({ message: 'Type "DEACTIVATE" to confirm.' }),
  }),
});
export type DeactivateProfessionalInput = z.infer<typeof deactivateProfessionalSchema>;
