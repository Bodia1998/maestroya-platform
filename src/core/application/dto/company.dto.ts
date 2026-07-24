import { z } from "zod";

/**
 * Module 18 — Company Professional. Same convention as professional.dto.ts:
 * one schema shared by the client form and the Server Action that receives
 * it. Deliberately absent from every schema here: `ownerUserId`, `status`,
 * `isVerified`, `stripeConnectAccountId` — ownership is always derived
 * server-side from the session, and the other three are mutated only
 * through their own dedicated paths (status transitions, CompanyVerification,
 * a future Stripe onboarding flow), never a general profile-edit form.
 */

const optionalTrimmed = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));

const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const createCompanySchema = z.object({
  legalName: z.string().trim().min(2, "Legal name is required.").max(200),
  tradeName: optionalTrimmed(200),
  taxId: z.string().trim().min(3, "Tax ID is required.").max(50),
  description: z.string().trim().max(5000).optional().or(z.literal("")),
  logoUrl: z.string().trim().url("Enter a valid URL.").optional().or(z.literal("")),
  websiteUrl: z.string().trim().url("Enter a valid URL.").optional().or(z.literal("")),
  contactEmail: z.string().trim().toLowerCase().email("Enter a valid email address.").optional().or(z.literal("")),
  contactPhone: z
    .string()
    .trim()
    .regex(/^\+?[0-9\s-]{7,20}$/, "Enter a valid phone number.")
    .optional()
    .or(z.literal("")),
  addressLine: optionalTrimmed(200),
  city: optionalTrimmed(100),
  province: optionalTrimmed(100),
  postalCode: optionalTrimmed(20),
  country: optionalTrimmed(2),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  categoryIds: z.array(z.string().uuid()).max(20, "Select up to 20 categories.").optional(),
});
export type CreateCompanyInput = z.infer<typeof createCompanySchema>;

// Update omits legalName/taxId re-verification concerns are out of scope —
// legal identity fields stay editable (same as ProfessionalProfile.taxId),
// but never categoryIds, which has its own dedicated action, and never
// status/isVerified.
export const updateCompanySchema = createCompanySchema.omit({ taxId: true, categoryIds: true }).extend({
  isAcceptingRequests: z.boolean().optional(),
});
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;

export const updateCompanyServicesSchema = z.object({
  categoryIds: z
    .array(z.string().uuid())
    .min(1, "Select at least one service category.")
    .max(20, "Select up to 20 categories."),
});
export type UpdateCompanyServicesInput = z.infer<typeof updateCompanyServicesSchema>;

// --- Admin schemas ---

export const listAdminCompaniesSchema = paginationSchema.extend({
  search: z.string().trim().max(100).optional(),
  status: z.enum(["PENDING", "ACTIVE", "SUSPENDED", "DEACTIVATED"]).optional(),
});
export type ListAdminCompaniesInput = z.infer<typeof listAdminCompaniesSchema>;

export const adminCompanyIdSchema = z.object({
  companyId: z.string().uuid("Invalid company."),
});
export type AdminCompanyIdInput = z.infer<typeof adminCompanyIdSchema>;

// --- Discovery ---

export const searchCompaniesSchema = z.object({
  categoryId: z.string().uuid("Select a valid category."),
});
export type SearchCompaniesInput = z.infer<typeof searchCompaniesSchema>;
