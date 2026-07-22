import { z } from "zod";

import { ALLOWED_AVATAR_MIME_TYPES, MAX_AVATAR_BYTES } from "@/application/dto/profile.dto";

/**
 * Same convention as profile.dto.ts/professional.dto.ts: one schema shared
 * by the client form (via @hookform/resolvers/zod) and the Server Action
 * that receives it.
 *
 * Photo validation deliberately reuses profile.dto.ts's existing
 * ALLOWED_AVATAR_MIME_TYPES/MAX_AVATAR_BYTES (the same Cloudinary-backed
 * allowlist/size limit the avatar upload path already established) rather
 * than inventing a second copy of the same constants that could drift out
 * of sync — request photos have no format/size requirements different from
 * avatars.
 */
export const ALLOWED_REQUEST_PHOTO_MIME_TYPES = ALLOWED_AVATAR_MIME_TYPES;
export const MAX_REQUEST_PHOTO_BYTES = MAX_AVATAR_BYTES;
export const MAX_PHOTOS_PER_REQUEST = 6;

export const MAX_SERVICE_REQUEST_TITLE_LENGTH = 150;
export const MAX_SERVICE_REQUEST_DESCRIPTION_LENGTH = 5000;

const REQUEST_URGENCY_VALUES = ["LOW", "MEDIUM", "HIGH", "EMERGENCY"] as const;

export const serviceRequestLocationSchema = z.object({
  line1: z.string().trim().min(1, "Enter a street address.").max(200),
  line2: z.string().trim().max(200).optional().or(z.literal("")),
  city: z.string().trim().min(1, "Enter a city.").max(100),
  province: z.string().trim().max(100).optional().or(z.literal("")),
  postalCode: z.string().trim().min(1, "Enter a postal code.").max(20),
  country: z.string().trim().min(2, "Enter a country.").max(100).default("ES"),
  latitude: z.coerce.number().min(-90, "Latitude must be between -90 and 90.").max(90, "Latitude must be between -90 and 90.").optional(),
  longitude: z.coerce.number().min(-180, "Longitude must be between -180 and 180.").max(180, "Longitude must be between -180 and 180.").optional(),
});
export type ServiceRequestLocationInput = z.infer<typeof serviceRequestLocationSchema>;

export const createServiceRequestSchema = z
  .object({
    categoryId: z.string().uuid("Select a valid service category."),
    title: z
      .string()
      .trim()
      .min(1, "Enter a title.")
      .max(MAX_SERVICE_REQUEST_TITLE_LENGTH, `Title must be ${MAX_SERVICE_REQUEST_TITLE_LENGTH} characters or fewer.`),
    description: z
      .string()
      .trim()
      .min(1, "Enter a description.")
      .max(
        MAX_SERVICE_REQUEST_DESCRIPTION_LENGTH,
        `Description must be ${MAX_SERVICE_REQUEST_DESCRIPTION_LENGTH} characters or fewer.`,
      ),
    urgency: z.enum(REQUEST_URGENCY_VALUES).optional(),
    budgetMin: z.coerce.number().min(0, "Budget cannot be negative.").optional(),
    budgetMax: z.coerce.number().min(0, "Budget cannot be negative.").optional(),
    location: serviceRequestLocationSchema,
  })
  .refine((data) => data.budgetMin === undefined || data.budgetMax === undefined || data.budgetMin <= data.budgetMax, {
    message: "Minimum budget must not exceed maximum budget.",
    path: ["budgetMax"],
  });
export type CreateServiceRequestInput = z.infer<typeof createServiceRequestSchema>;

// Update reuses the same field-level rules as create, but every field is
// optional — the customer only re-submits what they're changing, and
// UpdateServiceRequestUseCase fills in the rest from the existing record.
export const updateServiceRequestSchema = z
  .object({
    categoryId: z.string().uuid("Select a valid service category.").optional(),
    title: z
      .string()
      .trim()
      .min(1, "Enter a title.")
      .max(MAX_SERVICE_REQUEST_TITLE_LENGTH, `Title must be ${MAX_SERVICE_REQUEST_TITLE_LENGTH} characters or fewer.`)
      .optional(),
    description: z
      .string()
      .trim()
      .min(1, "Enter a description.")
      .max(
        MAX_SERVICE_REQUEST_DESCRIPTION_LENGTH,
        `Description must be ${MAX_SERVICE_REQUEST_DESCRIPTION_LENGTH} characters or fewer.`,
      )
      .optional(),
    urgency: z.enum(REQUEST_URGENCY_VALUES).optional(),
    budgetMin: z.coerce.number().min(0, "Budget cannot be negative.").optional(),
    budgetMax: z.coerce.number().min(0, "Budget cannot be negative.").optional(),
    location: serviceRequestLocationSchema.optional(),
  })
  .refine((data) => data.budgetMin === undefined || data.budgetMax === undefined || data.budgetMin <= data.budgetMax, {
    message: "Minimum budget must not exceed maximum budget.",
    path: ["budgetMax"],
  });
export type UpdateServiceRequestInput = z.infer<typeof updateServiceRequestSchema>;

export const addServiceRequestPhotoSchema = z.object({
  requestId: z.string().uuid(),
  caption: z.string().trim().max(200).optional().or(z.literal("")),
});
export type AddServiceRequestPhotoInput = z.infer<typeof addServiceRequestPhotoSchema>;

export const removeServiceRequestPhotoSchema = z.object({
  requestId: z.string().uuid(),
  photoId: z.string().uuid(),
});
export type RemoveServiceRequestPhotoInput = z.infer<typeof removeServiceRequestPhotoSchema>;

export const cancelServiceRequestSchema = z.object({
  requestId: z.string().uuid(),
});
export type CancelServiceRequestInput = z.infer<typeof cancelServiceRequestSchema>;
