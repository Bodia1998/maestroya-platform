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
  line1: z.string().trim().min(1, "dto.address.street").max(200),
  line2: z.string().trim().max(200).optional().or(z.literal("")),
  city: z.string().trim().min(1, "dto.address.city").max(100),
  province: z.string().trim().max(100).optional().or(z.literal("")),
  postalCode: z.string().trim().min(1, "dto.address.postalCode").max(20),
  country: z.string().trim().min(2, "dto.address.country").max(100).default("ES"),
  latitude: z.coerce.number().min(-90, "dto.location.latitudeRange").max(90, "dto.location.latitudeRange").optional(),
  longitude: z.coerce.number().min(-180, "dto.location.longitudeRange").max(180, "dto.location.longitudeRange").optional(),
});
export type ServiceRequestLocationInput = z.infer<typeof serviceRequestLocationSchema>;

export const createServiceRequestSchema = z
  .object({
    categoryId: z.string().uuid("dto.categories.invalid"),
    title: z
      .string()
      .trim()
      .min(1, "dto.serviceRequest.titleRequired")
      .max(MAX_SERVICE_REQUEST_TITLE_LENGTH, "maxLength"),
    description: z
      .string()
      .trim()
      .min(1, "dto.serviceRequest.descriptionRequired")
      .max(
        MAX_SERVICE_REQUEST_DESCRIPTION_LENGTH,
        "maxLength",
      ),
    urgency: z.enum(REQUEST_URGENCY_VALUES).optional(),
    budgetMin: z.coerce.number().min(0, "dto.serviceRequest.budgetNegative").optional(),
    budgetMax: z.coerce.number().min(0, "dto.serviceRequest.budgetNegative").optional(),
    location: serviceRequestLocationSchema,
  })
  .refine((data) => data.budgetMin === undefined || data.budgetMax === undefined || data.budgetMin <= data.budgetMax, {
    message: "dto.serviceRequest.budgetRange",
    path: ["budgetMax"],
  });
export type CreateServiceRequestInput = z.infer<typeof createServiceRequestSchema>;

// Update reuses the same field-level rules as create, but every field is
// optional — the customer only re-submits what they're changing, and
// UpdateServiceRequestUseCase fills in the rest from the existing record.
export const updateServiceRequestSchema = z
  .object({
    categoryId: z.string().uuid("dto.categories.invalid").optional(),
    title: z
      .string()
      .trim()
      .min(1, "dto.serviceRequest.titleRequired")
      .max(MAX_SERVICE_REQUEST_TITLE_LENGTH, "maxLength")
      .optional(),
    description: z
      .string()
      .trim()
      .min(1, "dto.serviceRequest.descriptionRequired")
      .max(
        MAX_SERVICE_REQUEST_DESCRIPTION_LENGTH,
        "maxLength",
      )
      .optional(),
    urgency: z.enum(REQUEST_URGENCY_VALUES).optional(),
    budgetMin: z.coerce.number().min(0, "dto.serviceRequest.budgetNegative").optional(),
    budgetMax: z.coerce.number().min(0, "dto.serviceRequest.budgetNegative").optional(),
    location: serviceRequestLocationSchema.optional(),
  })
  .refine((data) => data.budgetMin === undefined || data.budgetMax === undefined || data.budgetMin <= data.budgetMax, {
    message: "dto.serviceRequest.budgetRange",
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
