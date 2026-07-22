import { z } from "zod";

/**
 * Professional Discovery & Search module.
 *
 * Same convention as professional.dto.ts: one schema shared by the
 * client-facing search form and the Server Action/page that receives it.
 *
 * Deliberately absent: any field that would let the public client control
 * professional `status`, `verificationStatus`, or which professionals are
 * eligible for discovery — those are enforced server-side in
 * SearchProfessionalsUseCase / ProfessionalDiscoveryRepository, never
 * accepted as input here.
 */

export const searchProfessionalsSchema = z.object({
  categoryId: z.string().uuid("Select a valid service category."),
  latitude: z.coerce
    .number({ invalid_type_error: "Enter a valid latitude." })
    .min(-90, "Latitude must be between -90 and 90.")
    .max(90, "Latitude must be between -90 and 90."),
  longitude: z.coerce
    .number({ invalid_type_error: "Enter a valid longitude." })
    .min(-180, "Longitude must be between -180 and 180.")
    .max(180, "Longitude must be between -180 and 180."),
  page: z.coerce.number().int().min(1).max(1000).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(50).optional().default(20),
});
export type SearchProfessionalsInput = z.infer<typeof searchProfessionalsSchema>;

export const getProfessionalPublicProfileSchema = z.object({
  professionalId: z.string().uuid("Invalid professional id."),
});
export type GetProfessionalPublicProfileInput = z.infer<
  typeof getProfessionalPublicProfileSchema
>;
