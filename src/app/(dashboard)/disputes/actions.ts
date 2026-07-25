"use server";

import { revalidatePath } from "next/cache";

import {
  addDisputeEvidenceSchema,
  addDisputeMessageSchema,
  createDisputeSchema,
  listMyDisputesSchema,
} from "@/application/dto/dispute.dto";
import {
  makeAddDisputeEvidenceUseCase,
  makeAddDisputeMessageUseCase,
  makeCreateDisputeUseCase,
  makeGetDisputeByIdUseCase,
  makeListDisputesAgainstMeUseCase,
  makeListMyDisputesUseCase,
} from "@/application/use-cases/dispute/compose";
import { DomainError } from "@/domain/errors/domain-error";
import type { DisputeRecord } from "@/domain/repositories/dispute-repository";
import type { DisputeDetail } from "@/application/use-cases/dispute/get-dispute-by-id.use-case";
import { requireAuth } from "@/infrastructure/auth/rbac";

/**
 * Module 21 — Disputes & Support: customer/professional-facing Server
 * Action adapters — same "thin adapter, business logic in the use case"
 * convention as reviews/actions.ts. Every action derives the caller from
 * `requireAuth()` and re-verifies ownership inside the composed use case
 * (never trusting a client-supplied ownership claim) — see
 * resolveDisputeActor's own doc comment for the IDOR-prevention guarantee
 * this relies on.
 */
export type ActionResult<T = undefined> = { success: true; data: T } | { success: false; error: string };

function fromDomainError<T>(error: unknown, fallback: string): ActionResult<T> {
  if (error instanceof DomainError) {
    return { success: false, error: error.message };
  }
  console.error(error);
  return { success: false, error: fallback };
}

export async function createDisputeAction(input: {
  jobId: string;
  reason: string;
  title: string;
  description: string;
}): Promise<ActionResult<DisputeRecord>> {
  const user = await requireAuth();
  const parsed = createDisputeSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid dispute." };
  }
  try {
    const dispute = await makeCreateDisputeUseCase().execute(user.id, parsed.data);
    revalidatePath("/disputes");
    return { success: true, data: dispute };
  } catch (error) {
    return fromDomainError(error, "Something went wrong opening this dispute.");
  }
}

export async function listMyDisputesAction(
  input: { limit?: number; offset?: number; status?: string } = {},
): Promise<ActionResult<DisputeRecord[]>> {
  const user = await requireAuth();
  const parsed = listMyDisputesSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }
  try {
    const disputes = await makeListMyDisputesUseCase().execute(user.id, parsed.data);
    return { success: true, data: disputes };
  } catch (error) {
    return fromDomainError(error, "Something went wrong loading your disputes.");
  }
}

export async function listDisputesAgainstMeAction(): Promise<ActionResult<DisputeRecord[]>> {
  const user = await requireAuth();
  try {
    const disputes = await makeListDisputesAgainstMeUseCase().execute(user.id);
    return { success: true, data: disputes };
  } catch (error) {
    return fromDomainError(error, "Something went wrong loading disputes.");
  }
}

export async function getDisputeAction(disputeId: string): Promise<ActionResult<DisputeDetail>> {
  const user = await requireAuth();
  try {
    const detail = await makeGetDisputeByIdUseCase().execute(user.id, disputeId);
    return { success: true, data: detail };
  } catch (error) {
    return fromDomainError(error, "Something went wrong loading this dispute.");
  }
}

export async function addDisputeMessageAction(disputeId: string, body: string): Promise<ActionResult> {
  const user = await requireAuth();
  const parsed = addDisputeMessageSchema.safeParse({ disputeId, body });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid message." };
  }
  try {
    await makeAddDisputeMessageUseCase().execute(user.id, parsed.data.disputeId, parsed.data.body);
    revalidatePath(`/disputes/${disputeId}`);
    return { success: true, data: undefined };
  } catch (error) {
    return fromDomainError(error, "Something went wrong sending this message.");
  }
}

export async function addDisputeEvidenceAction(input: {
  disputeId: string;
  fileUrl: string;
  fileName?: string;
  fileType?: string;
  fileSizeBytes?: number;
  description?: string;
}): Promise<ActionResult> {
  const user = await requireAuth();
  const parsed = addDisputeEvidenceSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid evidence." };
  }
  try {
    await makeAddDisputeEvidenceUseCase().execute(user.id, parsed.data.disputeId, {
      fileUrl: parsed.data.fileUrl,
      fileName: parsed.data.fileName ?? null,
      fileType: parsed.data.fileType ?? null,
      fileSizeBytes: parsed.data.fileSizeBytes ?? null,
      description: parsed.data.description ? parsed.data.description : null,
    });
    revalidatePath(`/disputes/${input.disputeId}`);
    return { success: true, data: undefined };
  } catch (error) {
    return fromDomainError(error, "Something went wrong attaching this evidence.");
  }
}
