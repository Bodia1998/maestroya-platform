import { z } from "zod";

/**
 * Feature Flags module — schemas shared by:
 *
 *  1. `infrastructure/feature-flags/feature-flag-definitions.ts`, which
 *     validates the optional `FEATURE_FLAGS_CONFIG` env var (a JSON array
 *     of definitions) at startup.
 *  2. `FeatureFlagService.updateFlag`'s input, once a future admin
 *     API/UI calls it — same "one schema shared by the client-facing
 *     boundary and the use case it calls" convention as `admin.dto.ts`.
 *
 * Deliberately does not import `ROLES`/`RoleKey`
 * (`infrastructure/auth/rbac.ts`) to validate `roleAllowList` — role keys
 * here are treated as opaque strings, matching
 * `FeatureFlagTargeting.roleAllowList`'s own `readonly string[]` typing
 * (see `domain/entities/feature-flag.ts`'s doc comment on why the domain
 * layer can't reference `RoleKey`). A future admin API layer is free to
 * cross-check submitted role keys against `ROLES` itself before calling
 * `updateFlag`, the same way `ChangeUserRoleUseCase` validates against
 * `AdminRepository.listRoleKeys()` — that validation belongs with the
 * role system, not duplicated into this module's schema.
 */

const featureFlagKeySchema = z
  .string()
  .trim()
  .min(1, "Flag key is required.")
  .max(100, "Flag key must be 100 characters or fewer.")
  .regex(/^[a-z0-9][a-z0-9-_.]*$/i, "Flag key may only contain letters, numbers, '-', '_' and '.'.");

export const featureFlagEnvironmentSchema = z.enum(["development", "test", "production"]);

export const featureFlagRolloutConfigSchema = z.object({
  percentage: z.number().min(0).max(100),
});

export const featureFlagVariantSchema = z.object({
  name: z.string().trim().min(1).max(50),
  weight: z.number().positive(),
});

export const featureFlagTargetingSchema = z.object({
  userAllowList: z.array(z.string().trim().min(1)).optional(),
  userDenyList: z.array(z.string().trim().min(1)).optional(),
  roleAllowList: z.array(z.string().trim().min(1)).optional(),
});

export const featureFlagDefinitionSchema = z.object({
  key: featureFlagKeySchema,
  description: z.string().trim().max(500).optional(),
  enabled: z.boolean(),
  killSwitch: z.boolean().optional(),
  environments: z.array(featureFlagEnvironmentSchema).min(1).optional(),
  rollout: featureFlagRolloutConfigSchema.optional(),
  targeting: featureFlagTargetingSchema.optional(),
  variants: z.array(featureFlagVariantSchema).min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  updatedAt: z.string().optional(),
});
export type FeatureFlagDefinitionInput = z.infer<typeof featureFlagDefinitionSchema>;

/** The array-of-definitions shape `FEATURE_FLAGS_CONFIG` must parse to. */
export const featureFlagsConfigSchema = z.array(featureFlagDefinitionSchema);

/**
 * A partial update — every field optional, `key` excluded entirely (the
 * target flag's key is always a separate argument, e.g.
 * `FeatureFlagService.updateFlag(actorUserId, key, patch)`, never part of
 * the patch body, the same "id identifies the target, never part of the
 * payload that could rename it" convention as e.g. `moderateReviewSchema`
 * in `admin.dto.ts`).
 */
export const updateFeatureFlagSchema = featureFlagDefinitionSchema.omit({ key: true }).partial();
export type UpdateFeatureFlagInput = z.infer<typeof updateFeatureFlagSchema>;

export const featureFlagKeyParamSchema = featureFlagKeySchema;

export const featureFlagEvaluationContextSchema = z.object({
  userId: z.string().trim().min(1).optional(),
  roles: z.array(z.string()).optional(),
  environment: featureFlagEnvironmentSchema.optional(),
  attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});
export type FeatureFlagEvaluationContextInput = z.infer<typeof featureFlagEvaluationContextSchema>;
