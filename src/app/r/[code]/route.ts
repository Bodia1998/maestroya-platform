import { randomUUID } from "crypto";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { makeTrackVisitUseCase } from "@/application/use-cases/referral/compose";
import { makeAntiAbuseService } from "@/application/use-cases/security/compose";
import { hashIp } from "@/domain/services/security-key";
import { env } from "@/infrastructure/config/env";
import { logger } from "@/infrastructure/observability/logger";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/infrastructure/observability/request-id";
import { withApiTracing } from "@/infrastructure/tracing/http-tracing";

/**
 * Module 96 — Referral & Affiliate Production Wiring.
 *
 * Public entry point for every shared referral/campaign link
 * (`/r/<code>?to=/some/path&utm_source=...`). Thin controller — records
 * the click via `TrackVisitUseCase` (Module 60), sets a long-lived
 * first-party `mv_visitor` cookie identifying this browser for later
 * attribution, and redirects on to the intended destination.
 *
 * Open-redirect prevention: `?to=` must be a root-relative, same-origin
 * path (mirrors `isSafeRelativeCallbackUrl` in
 * `resolve-post-login-destination.ts` — a single leading `/`, never `//`
 * or `/\`, which browsers can treat as protocol-relative). Any other
 * value (missing, absolute, protocol-relative) falls back to `/`, never
 * to an attacker-supplied destination.
 *
 * `visitorId`: read from the existing `mv_visitor` cookie if present
 * (so a returning visitor is recognized across multiple referral clicks
 * — required for `TrackVisitUseCase`'s dedup window and for
 * `applyAttributionTouch`'s multi-touch state to mean anything), else a
 * fresh `randomUUID()` is minted and set. This is an anonymous,
 * non-guessable identifier — never a partner id, never a DB primary key
 * of anything sensitive — so no internal id is leaked to the client.
 *
 * A failure recording the visit never blocks the redirect — a broken
 * analytics pipeline must not be able to break a legitimate marketing
 * link for real visitors.
 */
const VISITOR_COOKIE = "mv_visitor";
const VISITOR_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // 1 year — matches typical attribution windows.

function isSafeRelativePath(url: string): boolean {
  return url.startsWith("/") && !url.startsWith("//") && !url.startsWith("/\\");
}

export const GET = withApiTracing("/r/[code]", async function GET(
  request: NextRequest,
  context: { params: Promise<{ code: string }> },
) {
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
  const { code } = await context.params;

  const requestedTo = request.nextUrl.searchParams.get("to");
  const destination = requestedTo && isSafeRelativePath(requestedTo) ? requestedTo : "/";

  const existingVisitorId = request.cookies.get(VISITOR_COOKIE)?.value;
  const visitorId = existingVisitorId && existingVisitorId.length <= 100 ? existingVisitorId : randomUUID();

  const response = NextResponse.redirect(new URL(destination, request.url), { status: 302 });
  response.headers.set(REQUEST_ID_HEADER, requestId);
  response.cookies.set(VISITOR_COOKIE, visitorId, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: VISITOR_COOKIE_MAX_AGE_SECONDS,
  });

  try {
    const forwardedFor = request.headers.get("x-forwarded-for");
    const rawIp = forwardedFor?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || null;

    // Module 96 — Referral & Affiliate Production Wiring: rate-limits
    // the *tracking write* (TrackVisitUseCase), never the redirect
    // itself — this route's own doc comment already establishes that a
    // failure recording the visit must never block a legitimate visitor,
    // and a rate-limit breach is treated identically: the visitor still
    // reaches their destination, only the click is not recorded once an
    // IP is scripting far more clicks than any real marketing link could
    // organically generate. See RATE_LIMIT_POLICIES.REFERRAL_CLICK_BY_IP.
    if (rawIp) {
      const ipHash = hashIp(rawIp, env.AUTH_SECRET);
      try {
        await makeAntiAbuseService().enforceRateLimit("REFERRAL_CLICK_BY_IP", { ipHash }, "RATE_LIMIT_TRIGGERED");
      } catch {
        logger.info("referral.click.rate_limited", { requestId, route: "/r/[code]", referralCode: code });
        return response;
      }
    }

    const result = await makeTrackVisitUseCase().execute({
      visitorId,
      referralCode: code,
      utmSource: request.nextUrl.searchParams.get("utm_source"),
      utmMedium: request.nextUrl.searchParams.get("utm_medium"),
      utmCampaign: request.nextUrl.searchParams.get("utm_campaign"),
      utmContent: request.nextUrl.searchParams.get("utm_content"),
      utmTerm: request.nextUrl.searchParams.get("utm_term"),
      landingPage: destination,
      refererHost: safeHostname(request.headers.get("referer")),
      rawIp,
      userAgent: request.headers.get("user-agent"),
    });

    logger.info("referral.click", {
      requestId,
      route: "/r/[code]",
      referralCode: code,
      deduped: result.deduped,
      hasVisit: result.visit !== null,
    });
  } catch (error) {
    logger.warn("referral.click.failed", {
      requestId,
      route: "/r/[code]",
      referralCode: code,
      error: error instanceof Error ? error.message : "unknown",
    });
    // Never block the redirect — see doc comment above.
  }

  return response;
});

function safeHostname(referer: string | null): string | null {
  if (!referer) return null;
  try {
    return new URL(referer).hostname;
  } catch {
    return null;
  }
}
