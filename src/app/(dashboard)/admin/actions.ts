"use server";

import { revalidatePath } from "next/cache";

import {
  adminPortfolioItemIdSchema,
  adminReviewIdSchema,
  adminUserIdSchema,
  changeUserRoleSchema,
  listAdminAuditLogsSchema,
  listAdminJobsSchema,
  listAdminPortfolioItemsSchema,
  listAdminProfessionalsSchema,
  listAdminQuotesSchema,
  listAdminReviewsSchema,
  listAdminServiceRequestsSchema,
  listAdminUsersSchema,
  moderatePortfolioItemSchema,
  moderateReviewSchema,
} from "@/application/dto/admin.dto";
import {
  makeChangeUserRoleUseCase,
  makeGetAdminDashboardOverviewUseCase,
  makeListAdminAuditLogsUseCase,
  makeListAdminJobsUseCase,
  makeListAdminPortfolioItemsUseCase,
  makeListAdminProfessionalsUseCase,
  makeListAdminQuotesUseCase,
  makeListAdminReviewsUseCase,
  makeListAdminServiceRequestsUseCase,
  makeListAdminUsersUseCase,
  makeModeratePortfolioItemUseCase,
  makeModerateReviewUseCase,
  makeReactivateAdminUserUseCase,
  makeRestorePortfolioItemUseCase,
  makeRestoreReviewUseCase,
  makeSuspendAdminUserUseCase,
} from "@/application/use-cases/admin/compose";
import { normalizeModerationReason } from "@/domain/services/admin-rules";
import { DomainError } from "@/domain/errors/domain-error";
import type { AdminAuditLogRecord } from "@/domain/repositories/admin-audit-log-repository";
import type {
  AdminDashboardOverview,
  AdminJobRecord,
  AdminPortfolioItemRecord,
  AdminProfessionalRecord,
  AdminQuoteRecord,
  AdminReviewRecord,
  AdminServiceRequestRecord,
  AdminUserRecord,
} from "@/domain/repositories/admin-repository";
import { ROLES, requireRole } from "@/infrastructure/auth/rbac";

/**
 * Admin Panel module (Module 16): thin Server Action adapters — same
 * pattern as every other module's actions.ts (see notifications/actions.ts,
 * reviews/actions.ts). All business logic lives in the composed use cases;
 * this file's only jobs are: (1) enforce ADMIN/SUPER_ADMIN access via
 * `requireRole()`, (2) validate client input with Zod, (3) call a use case
 * with the *session-derived* admin id, never a client-supplied one, and
 * (4) translate the result/error into the shared ActionResult shape.
 *
 * IMPORTANT: every action below calls `requireRole(ROLES.ADMIN,
 * ROLES.SUPER_ADMIN)` before doing anything else. There is no code path
 * here that reads a role, adminId, or "isAdmin" flag from client input —
 * the only source of truth for "is this caller an admin" is the
 * authenticated session (see rbac.ts). A customer or professional calling
 * any of these with a forged `userId`/`role`/`adminUserId` field gets
 * exactly the same UnauthorizedError as an unauthenticated caller.
 */

export type ActionResult<T = undefined> = { success: true; data: T } | { success: false; error: string };

function fromDomainError<T>(error: unknown, fallback: string): ActionResult<T> {
  if (error instanceof DomainError) {
    return { success: false, error: error.message };
  }
  console.error(error);
  return { success: false, error: fallback };
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export async function getAdminDashboardOverviewAction(): Promise<ActionResult<AdminDashboardOverview>> {
  await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  try {
    const overview = await makeGetAdminDashboardOverviewUseCase().execute();
    return { success: true, data: overview };
  } catch (error) {
    return fromDomainError(error, "Something went wrong loading the dashboard.");
  }
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export async function listAdminUsersAction(
  input: { limit?: number; offset?: number; search?: string } = {},
): Promise<ActionResult<AdminUserRecord[]>> {
  await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  const parsed = listAdminUsersSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }
  try {
    const users = await makeListAdminUsersUseCase().execute(parsed.data);
    return { success: true, data: users };
  } catch (error) {
    return fromDomainError(error, "Something went wrong loading users.");
  }
}

export async function suspendUserAction(userId: string): Promise<ActionResult<AdminUserRecord>> {
  const admin = await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  const parsed = adminUserIdSchema.safeParse({ userId });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid user." };
  }
  try {
    const user = await makeSuspendAdminUserUseCase().execute(admin.id, parsed.data.userId);
    revalidatePath("/admin/users");
    return { success: true, data: user };
  } catch (error) {
    return fromDomainError(error, "Something went wrong suspending this user.");
  }
}

export async function reactivateUserAction(userId: string): Promise<ActionResult<AdminUserRecord>> {
  const admin = await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  const parsed = adminUserIdSchema.safeParse({ userId });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid user." };
  }
  try {
    const user = await makeReactivateAdminUserUseCase().execute(admin.id, parsed.data.userId);
    revalidatePath("/admin/users");
    return { success: true, data: user };
  } catch (error) {
    return fromDomainError(error, "Something went wrong reactivating this user.");
  }
}

export async function changeUserRoleAction(userId: string, roles: string[]): Promise<ActionResult<AdminUserRecord>> {
  const admin = await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  const parsed = changeUserRoleSchema.safeParse({ userId, roles });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid role change." };
  }
  try {
    const user = await makeChangeUserRoleUseCase().execute(admin.id, parsed.data.userId, parsed.data.roles);
    revalidatePath("/admin/users");
    return { success: true, data: user };
  } catch (error) {
    return fromDomainError(error, "Something went wrong changing this user's role.");
  }
}

// ---------------------------------------------------------------------------
// Professionals (read-only oversight)
// ---------------------------------------------------------------------------

export async function listAdminProfessionalsAction(
  input: { limit?: number; offset?: number; search?: string } = {},
): Promise<ActionResult<AdminProfessionalRecord[]>> {
  await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  const parsed = listAdminProfessionalsSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }
  try {
    const professionals = await makeListAdminProfessionalsUseCase().execute(parsed.data);
    return { success: true, data: professionals };
  } catch (error) {
    return fromDomainError(error, "Something went wrong loading professionals.");
  }
}

// ---------------------------------------------------------------------------
// Service requests (read-only oversight)
// ---------------------------------------------------------------------------

export async function listAdminServiceRequestsAction(
  input: { limit?: number; offset?: number; status?: string } = {},
): Promise<ActionResult<AdminServiceRequestRecord[]>> {
  await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  const parsed = listAdminServiceRequestsSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }
  try {
    const requests = await makeListAdminServiceRequestsUseCase().execute(parsed.data);
    return { success: true, data: requests };
  } catch (error) {
    return fromDomainError(error, "Something went wrong loading service requests.");
  }
}

// ---------------------------------------------------------------------------
// Quotes (read-only oversight)
// ---------------------------------------------------------------------------

export async function listAdminQuotesAction(
  input: { limit?: number; offset?: number; status?: string } = {},
): Promise<ActionResult<AdminQuoteRecord[]>> {
  await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  const parsed = listAdminQuotesSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }
  try {
    const quotes = await makeListAdminQuotesUseCase().execute(parsed.data);
    return { success: true, data: quotes };
  } catch (error) {
    return fromDomainError(error, "Something went wrong loading quotes.");
  }
}

// ---------------------------------------------------------------------------
// Appointments / jobs (read-only oversight)
// ---------------------------------------------------------------------------

export async function listAdminJobsAction(
  input: { limit?: number; offset?: number; status?: string } = {},
): Promise<ActionResult<AdminJobRecord[]>> {
  await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  const parsed = listAdminJobsSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }
  try {
    const jobs = await makeListAdminJobsUseCase().execute(parsed.data);
    return { success: true, data: jobs };
  } catch (error) {
    return fromDomainError(error, "Something went wrong loading appointments/jobs.");
  }
}

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

export async function listAdminReviewsAction(
  input: { limit?: number; offset?: number; status?: string } = {},
): Promise<ActionResult<AdminReviewRecord[]>> {
  await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  const parsed = listAdminReviewsSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }
  try {
    const reviews = await makeListAdminReviewsUseCase().execute(parsed.data);
    return { success: true, data: reviews };
  } catch (error) {
    return fromDomainError(error, "Something went wrong loading reviews.");
  }
}

export async function moderateReviewAction(reviewId: string, reason?: string): Promise<ActionResult<AdminReviewRecord>> {
  const admin = await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  const parsed = moderateReviewSchema.safeParse({ reviewId, reason });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid review." };
  }
  try {
    const review = await makeModerateReviewUseCase().execute(
      admin.id,
      parsed.data.reviewId,
      normalizeModerationReason(parsed.data.reason),
    );
    revalidatePath("/admin/reviews");
    return { success: true, data: review };
  } catch (error) {
    return fromDomainError(error, "Something went wrong moderating this review.");
  }
}

export async function restoreReviewAction(reviewId: string): Promise<ActionResult<AdminReviewRecord>> {
  const admin = await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  const parsed = adminReviewIdSchema.safeParse({ reviewId });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid review." };
  }
  try {
    const review = await makeRestoreReviewUseCase().execute(admin.id, parsed.data.reviewId);
    revalidatePath("/admin/reviews");
    return { success: true, data: review };
  } catch (error) {
    return fromDomainError(error, "Something went wrong restoring this review.");
  }
}

// ---------------------------------------------------------------------------
// Portfolio items
// ---------------------------------------------------------------------------

export async function listAdminPortfolioItemsAction(
  input: { limit?: number; offset?: number } = {},
): Promise<ActionResult<AdminPortfolioItemRecord[]>> {
  await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  const parsed = listAdminPortfolioItemsSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }
  try {
    const items = await makeListAdminPortfolioItemsUseCase().execute(parsed.data);
    return { success: true, data: items };
  } catch (error) {
    return fromDomainError(error, "Something went wrong loading portfolio items.");
  }
}

export async function moderatePortfolioItemAction(
  portfolioItemId: string,
  reason?: string,
): Promise<ActionResult<AdminPortfolioItemRecord>> {
  const admin = await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  const parsed = moderatePortfolioItemSchema.safeParse({ portfolioItemId, reason });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid portfolio item." };
  }
  try {
    const item = await makeModeratePortfolioItemUseCase().execute(
      admin.id,
      parsed.data.portfolioItemId,
      normalizeModerationReason(parsed.data.reason),
    );
    revalidatePath("/admin/portfolio");
    return { success: true, data: item };
  } catch (error) {
    return fromDomainError(error, "Something went wrong moderating this portfolio item.");
  }
}

export async function restorePortfolioItemAction(portfolioItemId: string): Promise<ActionResult<AdminPortfolioItemRecord>> {
  const admin = await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  const parsed = adminPortfolioItemIdSchema.safeParse({ portfolioItemId });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid portfolio item." };
  }
  try {
    const item = await makeRestorePortfolioItemUseCase().execute(admin.id, parsed.data.portfolioItemId);
    revalidatePath("/admin/portfolio");
    return { success: true, data: item };
  } catch (error) {
    return fromDomainError(error, "Something went wrong restoring this portfolio item.");
  }
}

// ---------------------------------------------------------------------------
// Audit logs (read-only)
// ---------------------------------------------------------------------------

export async function listAdminAuditLogsAction(
  input: { limit?: number; offset?: number } = {},
): Promise<ActionResult<AdminAuditLogRecord[]>> {
  await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  const parsed = listAdminAuditLogsSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }
  try {
    const logs = await makeListAdminAuditLogsUseCase().execute(parsed.data);
    return { success: true, data: logs };
  } catch (error) {
    return fromDomainError(error, "Something went wrong loading audit logs.");
  }
}

// ---------------------------------------------------------------------------
// Form-bindable wrappers
// ---------------------------------------------------------------------------
//
// A plain HTML <form action={...}> requires a Server Action shaped
// `(formData: FormData) => void | Promise<void>` — every mutation action
// above intentionally returns `ActionResult<T>` instead (so it can also be
// called from a richer client component that inspects success/error), so
// these thin wrappers exist purely to satisfy the `<form>` element's type
// contract for the minimal server-rendered admin UI (see
// src/app/(dashboard)/admin/users/page.tsx, reviews/page.tsx,
// portfolio/page.tsx). Each still goes through the exact same
// `requireRole()` + Zod validation + use case as its non-void counterpart —
// nothing here is a second, less-safe code path.

export async function suspendUserFormAction(userId: string): Promise<void> {
  await suspendUserAction(userId);
}

export async function reactivateUserFormAction(userId: string): Promise<void> {
  await reactivateUserAction(userId);
}

export async function moderateReviewFormAction(reviewId: string, reason?: string): Promise<void> {
  await moderateReviewAction(reviewId, reason);
}

export async function restoreReviewFormAction(reviewId: string): Promise<void> {
  await restoreReviewAction(reviewId);
}

export async function moderatePortfolioItemFormAction(portfolioItemId: string, reason?: string): Promise<void> {
  await moderatePortfolioItemAction(portfolioItemId, reason);
}

export async function restorePortfolioItemFormAction(portfolioItemId: string): Promise<void> {
  await restorePortfolioItemAction(portfolioItemId);
}
