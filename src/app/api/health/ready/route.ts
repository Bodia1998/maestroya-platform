import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { prisma } from "@/infrastructure/database/prisma/client";
import { logger } from "@/infrastructure/observability/logger";
import { createErrorReporter } from "@/infrastructure/observability/error-reporter-factory";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/infrastructure/observability/request-id";
import { getRedisClient } from "@/infrastructure/cache/redis-client-factory";
import { getCacheHealth } from "@/infrastructure/cache/compose";
import { getBackgroundJobsHealth } from "@/infrastructure/jobs/compose";
import { getSearchEngineHealth } from "@/infrastructure/search/compose";
import { getRealtimeHealth } from "@/infrastructure/realtime/compose";
import { getSmsProviderHealth } from "@/infrastructure/sms/compose";

/**
 * Readiness check (Module 25 — Production Infrastructure).
 *
 * Answers "can this instance safely receive production traffic right
 * now?" — checks the one dependency this application cannot function
 * without: PostgreSQL. Every read/write path in the app goes through
 * Prisma, so a database that's unreachable means every meaningful
 * request would fail anyway.
 *
 * Deliberately does *not* also check Cloudinary, Stripe, or email
 * delivery: those are optional/degradable dependencies (an upload
 * failing, a card not charging, or a transactional email not sending are
 * all handled — or handleable — as isolated failures within their own
 * flows) and marking the *entire instance* unready because a
 * third-party API is briefly slow would cause unnecessary failover/
 * restarts for a problem that isn't actually this instance's fault. See
 * docs/MODULE_25_PRODUCTION_INFRASTRUCTURE.md, "Health & readiness" for
 * the full reasoning.
 *
 * Module 44 — Redis Infrastructure: Redis joins that same
 * "optional/degradable" category, for the same reason and by explicit
 * design — every Redis-backed service in this codebase
 * (`CacheService`/`RateLimitRepository`/`DistributedLock`) already falls
 * back to a correct in-memory implementation on its own; Redis being
 * briefly unreachable is not this instance's failure to serve traffic.
 * `checks.cache` is reported for operational visibility only
 * (`"ok"`/`"error"`/`"not_configured"`) and never changes the response's
 * overall `status` or HTTP status code — unlike the database check, a
 * failing Redis check does not cause a 503.
 *
 * Module 45 — Background Jobs: `checks.queue` joins `checks.cache` in
 * that same "visibility only" category, for the identical reason — a
 * degraded background-job system does not mean this instance can't serve
 * HTTP traffic, and `"disabled"` (queued dispatch off — the default) is a
 * healthy, normal state. See `infrastructure/jobs/queue-health.ts`.
 *
 * Module 46 — Caching Layer: `checks.cachingLayer` reports the
 * `CacheManager`'s own driver, bypass flag, and hit/miss statistics —
 * distinct from `checks.cache` above (which only pings the raw Redis
 * connection). Also visibility-only, for the same reason: `CacheManager`
 * already degrades every operation to a safe miss/no-op on a provider
 * failure (see `application/services/cache/cache-manager.ts`), so it can
 * never be the thing that makes this instance unready.
 *
 * Module 47 — CQRS Search Engine: `checks.searchEngine` joins the same
 * visibility-only category, with the strongest claim to it of the four.
 * The search index is *derived* data — Postgres remains the source of
 * truth, `SearchReadModelUseCase` degrades an unreachable engine to an
 * empty, explicitly-flagged result rather than an error, and any
 * divergence is repairable by a rebuild. An instance whose search engine
 * is down still serves every page, booking, and payment, so a 503 here
 * would trigger a failover that cannot fix the actual problem. The report
 * additionally carries the indexing pipeline's own state (queue counts,
 * last successful sync, index version) — the things an operator needs to
 * tell "eventually consistent" apart from "silently broken". See
 * `infrastructure/search/search-health.ts`.
 *
 * Module 48 — Real-Time System: `checks.realtime` reports the SSE/
 * WebSocket transport status and live connection/channel/presence
 * counters (see `infrastructure/realtime/compose.ts`'s `getRealtimeHealth()`).
 * Also visibility-only, for the same reason as every module above: a
 * realtime delivery failure degrades one client's live-update experience,
 * never this instance's ability to serve HTTP/read/write traffic — every
 * realtime client already has its own reconnect logic.
 *
 * Module 49 — SMS Notifications: `checks.smsProvider` reports the
 * configured provider (`mock`/`twilio`), whether it has everything it
 * needs to send, and the `sms-dispatch` queue's counts (see
 * `infrastructure/sms/sms-health.ts`). Also visibility-only, for the
 * identical reason `checks.queue` already establishes: an SMS delivery
 * failure or misconfiguration degrades one best-effort notification
 * channel, never this instance's ability to serve HTTP/read/write
 * traffic.
 *
 * Returns 503 (not 500) on database failure — the conventional status
 * for "the server is currently unable to handle the request", which is
 * exactly what a load balancer/orchestrator readiness probe is checking
 * for.
 */
export async function GET(request: NextRequest) {
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));

  try {
    await prisma.$queryRaw`SELECT 1`;

    return NextResponse.json(
      {
        status: "ok",
        timestamp: new Date().toISOString(),
        checks: {
          database: "ok",
          cache: await checkCache(requestId),
          queue: await getBackgroundJobsHealth(),
          cachingLayer: getCacheHealth(),
          searchEngine: await getSearchEngineHealth(),
          realtime: getRealtimeHealth(),
          smsProvider: await getSmsProviderHealth(),
        },
      },
      { status: 200, headers: { [REQUEST_ID_HEADER]: requestId } },
    );
  } catch (error) {
    logger.error("readiness_check_failed", {
      requestId,
      route: "/api/health/ready",
      error,
    });

    // Module 39 — Sentry + CI/CD Hardening: a readiness probe failure
    // means the database is unreachable from this instance — always an
    // unexpected, operationally significant failure worth reporting, not
    // routine traffic.
    createErrorReporter().reportException(error, {
      tags: { route: "/api/health/ready", source: "http-route-handler" },
      extra: { requestId },
    });

    return NextResponse.json(
      {
        status: "error",
        timestamp: new Date().toISOString(),
        checks: { database: "error" },
      },
      { status: 503, headers: { [REQUEST_ID_HEADER]: requestId } },
    );
  }
}

/**
 * Module 44 — Redis Infrastructure: best-effort `PING`, purely for
 * operational visibility in the readiness payload — never thrown from,
 * never allowed to affect this route's overall status/HTTP code (see the
 * doc comment above). Returns `"not_configured"` without attempting a
 * connection at all when `REDIS_URL` is unset, which is the common,
 * intended case today.
 */
async function checkCache(requestId: string): Promise<"ok" | "error" | "not_configured"> {
  const client = getRedisClient();
  if (!client) return "not_configured";

  try {
    await client.command(["PING"]);
    return "ok";
  } catch (error) {
    logger.warn("readiness_cache_check_failed", { requestId, error });
    return "error";
  }
}
