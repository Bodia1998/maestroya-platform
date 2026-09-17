"use server";

import { revalidatePath } from "next/cache";

import { recordAiVisibilityObservationSchema } from "@/application/dto/ai-visibility.dto";
import { makeRecordAiVisibilityObservationUseCase } from "@/application/use-cases/ai-visibility/compose";
import { DomainError } from "@/domain/errors/domain-error";
import type { AiVisibilityObservationRecord } from "@/domain/repositories/ai-visibility-observation-repository";
import { ROLES, requireRole } from "@/infrastructure/auth/rbac";

/**
 * Module 119 — AI Recommendation Monitoring: same thin Server Action
 * convention as `admin/actions.ts` — enforce ADMIN/SUPER_ADMIN access,
 * validate with Zod, call the composed use case with the *session*-
 * derived evaluator id (never a client-supplied one), translate the
 * result into the shared `ActionResult` shape. This is the only mutation
 * this module exposes — there is no edit/delete action anywhere, matching
 * the observation trail's own append-only contract.
 */

export type ActionResult<T = undefined> = { success: true; data: T } | { success: false; error: string };

export async function recordAiVisibilityObservationAction(
  input: unknown,
): Promise<ActionResult<AiVisibilityObservationRecord>> {
  const user = await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);

  const parsed = recordAiVisibilityObservationSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid observation." };
  }

  try {
    const observation = await makeRecordAiVisibilityObservationUseCase().execute(user.id, {
      ...parsed.data,
      providerModel: parsed.data.providerModel ?? null,
      citationCorrect: parsed.data.citationCorrect,
      evaluatorNotes: parsed.data.evaluatorNotes ?? null,
      evidenceReference: parsed.data.evidenceReference ?? null,
      evidenceExcerpt: parsed.data.evidenceExcerpt ?? null,
    });
    revalidatePath("/admin/ai-visibility");
    return { success: true, data: observation };
  } catch (error) {
    if (error instanceof DomainError) {
      return { success: false, error: error.message };
    }
    console.error(error);
    return { success: false, error: "Something went wrong recording the observation." };
  }
}
