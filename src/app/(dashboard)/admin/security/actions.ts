"use server";

import { revalidatePath } from "next/cache";

import { DomainError } from "@/domain/errors/domain-error";
import { ROLES, requireRole } from "@/infrastructure/auth/rbac";
import {
  createAccountRestrictionSchema,
  listSecurityEventsSchema,
  toAdminAccountRestrictionView,
  toAdminSecurityEventView,
  type AdminAccountRestrictionView,
  type AdminSecurityEventView,
} from "@/application/dto/security.dto";
import {
  makeCreateAccountRestrictionUseCase,
  makeLiftAccountRestrictionUseCase,
  makeListAccountRestrictionsUseCase,
  makeListSecurityEventsUseCase,
} from "@/application/use-cases/security/compose";

/**
 * Security & Anti-Abuse module (Module 24): admin-only visibility into the
 * SecurityEvent log and AccountRestriction state (threat G — admin/
 * security abuse oversight). Deliberately gated to SUPER_ADMIN only, not
 * ADMIN/SUPPORT — see ListSecurityEventsUseCase's own doc comment for why.
 *
 * Every action here returns only the admin-safe DTO shapes from
 * application/dto/security.dto.ts — never a raw SecurityEventRecord/
 * AccountRestrictionRecord, and never an ipHash (see that file's own doc
 * comment on why ipHash is dropped even for an authorized admin).
 */
export type ActionResult = { success: true } | { success: false; error: string };

function fromDomainError(error: unknown, fallback: string): ActionResult {
  if (error instanceof DomainError) {
    return { success: false, error: error.message };
  }
  console.error(error);
  return { success: false, error: fallback };
}

export async function listSecurityEventsAction(
  input: unknown,
): Promise<{ success: true; events: AdminSecurityEventView[] } | { success: false; error: string }> {
  await requireRole(ROLES.SUPER_ADMIN);

  const parsed = listSecurityEventsSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Invalid filters." };
  }

  const events = await makeListSecurityEventsUseCase().execute({
    type: parsed.data.type,
    userId: parsed.data.userId,
    limit: parsed.data.limit,
    offset: parsed.data.offset,
  });
  return { success: true, events: events.map(toAdminSecurityEventView) };
}

export async function listAccountRestrictionsAction(
  userId?: string,
): Promise<{ success: true; restrictions: AdminAccountRestrictionView[] } | { success: false; error: string }> {
  await requireRole(ROLES.SUPER_ADMIN);

  const restrictions = await makeListAccountRestrictionsUseCase().execute({
    userId,
    limit: 50,
    offset: 0,
  });
  return { success: true, restrictions: restrictions.map(toAdminAccountRestrictionView) };
}

export async function createAccountRestrictionAction(formData: unknown): Promise<ActionResult> {
  const admin = await requireRole(ROLES.SUPER_ADMIN);

  const parsed = createAccountRestrictionSchema.safeParse(formData);
  if (!parsed.success) {
    return { success: false, error: "Invalid restriction details." };
  }

  try {
    await makeCreateAccountRestrictionUseCase().execute(admin.id, parsed.data);
    revalidatePath("/admin/security");
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "Something went wrong creating this restriction.");
  }
}

export async function liftAccountRestrictionAction(restrictionId: string): Promise<ActionResult> {
  const admin = await requireRole(ROLES.SUPER_ADMIN);

  try {
    await makeLiftAccountRestrictionUseCase().execute(admin.id, restrictionId);
    revalidatePath("/admin/security");
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "Something went wrong lifting this restriction.");
  }
}
