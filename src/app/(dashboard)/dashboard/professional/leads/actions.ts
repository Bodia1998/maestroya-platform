"use server";

import type { LeadContactDTO, LeadPreviewDTO } from "@/application/dto/lead-contact.dto";
import type { LeadFeedPageDTO } from "@/application/dto/lead-feed.dto";
import { requireAuth } from "@/infrastructure/auth/rbac";
import {
  makeGetLeadFeedForProfessionalUseCase,
  makeGetPublishedLeadPreviewUseCase,
  makeGetPublishedLeadPreviewsForProfessionalUseCase,
} from "@/application/use-cases/lead/compose";
import { makeGetLeadContactUseCase } from "@/application/use-cases/lead-contact/compose";
import { localizeActionError } from "@/presentation/i18n/server";

/**
 * Module 125 — professional Lead Preview entry points (read-only Server
 * Actions). Authorization lives in the Module 124 use cases: only an ACTIVE
 * ProfessionalProfile resolved from the session user sees anything; anyone
 * else (a plain customer included) gets an empty list / not-found. The DTO
 * is the Module 122 contact-safe LeadPreviewDTO, returned unchanged.
 */
export type LeadPreviewListResult = { success: true; leads: LeadPreviewDTO[] };
export type LeadPreviewResult = { success: true; lead: LeadPreviewDTO } | { success: false; error: string };

export async function getLeadPreviewsAction(): Promise<LeadPreviewListResult> {
  const user = await requireAuth();
  const leads = await makeGetPublishedLeadPreviewsForProfessionalUseCase().execute(user.id);
  return { success: true, leads };
}

export async function getLeadPreviewAction(leadId: unknown): Promise<LeadPreviewResult> {
  const user = await requireAuth();
  try {
    const lead = await makeGetPublishedLeadPreviewUseCase().execute(user.id, leadId as string);
    return { success: true, lead };
  } catch (error) {
    return { success: false, error: await localizeActionError(error) };
  }
}

/**
 * Module 134 — Lead Feed v2 entry point. Identity comes ONLY from the session;
 * the client supplies page size / cursor / category filter, never a user or
 * professional id. Marketplace-level data only (no contact access).
 */
export type LeadFeedResult = ({ success: true } & LeadFeedPageDTO) | { success: false; error: string };

export async function getLeadFeedAction(input?: { limit?: number; cursor?: string | null; categoryId?: string | null }): Promise<LeadFeedResult> {
  const user = await requireAuth();
  try {
    const page = await makeGetLeadFeedForProfessionalUseCase().execute(user.id, {
      limit: input?.limit,
      cursor: input?.cursor ?? null,
      categoryId: input?.categoryId ?? null,
    });
    return { success: true, ...page };
  } catch (error) {
    return { success: false, error: await localizeActionError(error) };
  }
}

/**
 * Module 138 — customer contact for a PURCHASED LEAD_V1 lead. The only input
 * is the lead id; the professional identity comes ONLY from the session (no
 * professionalProfileId / purchaseId is accepted). Access exists only while the
 * caller's own LeadPurchase for this lead is CONFIRMED — every other case
 * (no purchase, pending, failed, cancelled, refunded, revoked, someone else's
 * purchase, wrong flow) returns the same generic denial.
 */
export type LeadContactResult = { success: true; contact: LeadContactDTO } | { success: false; error: string };

export async function getLeadContactAction(leadId: unknown): Promise<LeadContactResult> {
  const user = await requireAuth();
  try {
    const contact = await makeGetLeadContactUseCase().execute(user.id, leadId as string);
    return { success: true, contact };
  } catch (error) {
    return { success: false, error: await localizeActionError(error) };
  }
}
