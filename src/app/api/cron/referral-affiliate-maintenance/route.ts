import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { env } from "@/infrastructure/config/env";
import { isValidCronAuthHeader } from "@/infrastructure/auth/cron-auth";
import { logger } from "@/infrastructure/observability/logger";
import { createErrorReporter } from "@/infrastructure/observability/error-reporter-factory";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/infrastructure/observability/request-id";
import { makeRunReferralAffiliateMaintenanceSweepUseCase } from "@/application/use-cases/affiliate/compose";
import { withApiTracing } from "@/infrastructure/tracing/http-tracing";

/**
 * Module 96 — Referral & Affiliate Production Wiring: the single HTTP
 * entry point for this module's scheduled maintenance sweep — commission
 * expiry (PENDING AffiliateCommission past its expiresAt -> EXPIRED) plus
 * a fraud-signal re-check across every currently-APPROVED partner. Same
 * shared-secret-bearer-token pattern, same Vercel Cron invocation model,
 * as every other cron route in this codebase — see
 * `expire-workflows/route.ts`'s own doc comment for the full reasoning
 * this route deliberately does not repeat.
 *
 * Deliberately does NOT trigger any payout — `CreatePartnerPayoutUseCase`
 * stays admin-triggered only (see MODULE_96's own report, "Payout
 * Lifecycle"). This is the one new scheduled job this module adds; no
 * second/duplicate scheduler exists anywhere else for referral/affiliate
 * data.
 *
 * Locking/idempotency/bounded-batch safety all live in
 * `RunReferralAffiliateMaintenanceSweepUseCase` itself (the existing
 * `DistributedLock`, Module 44) — this route is a thin auth + dispatch
 * layer, identical in shape to every other cron route.
 */
export const GET = withApiTracing("/api/cron/referral-affiliate-maintenance", async function GET(request: NextRequest) {
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
  const route = "/api/cron/referral-affiliate-maintenance";

  if (!env.CRON_SECRET) {
    logger.error("referral_affiliate_maintenance_cron_misconfigured", {
      requestId,
      route,
      reason: "CRON_SECRET is not configured",
    });
    return NextResponse.json(
      { status: "error", message: "Cron endpoint is not configured." },
      { status: 503, headers: { [REQUEST_ID_HEADER]: requestId } },
    );
  }

  const authHeader = request.headers.get("authorization");
  if (!isValidCronAuthHeader(authHeader, env.CRON_SECRET)) {
    logger.warn("referral_affiliate_maintenance_cron_unauthorized", { requestId, route });
    return NextResponse.json(
      { status: "error", message: "Unauthorized." },
      { status: 401, headers: { [REQUEST_ID_HEADER]: requestId } },
    );
  }

  try {
    const result = await makeRunReferralAffiliateMaintenanceSweepUseCase().execute(new Date());

    logger.info("referral_affiliate_maintenance_cron_completed", { requestId, route, ...result });

    return NextResponse.json(
      { status: "ok", timestamp: new Date().toISOString(), result },
      { status: 200, headers: { [REQUEST_ID_HEADER]: requestId } },
    );
  } catch (error) {
    logger.error("referral_affiliate_maintenance_cron_failed", { requestId, route, error });
    createErrorReporter().reportException(error, {
      tags: { route, source: "background-job" },
      extra: { requestId },
    });
    return NextResponse.json(
      { status: "error", message: "Referral/affiliate maintenance sweep failed." },
      { status: 500, headers: { [REQUEST_ID_HEADER]: requestId } },
    );
  }
});
