import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { DomainError } from "@/domain/errors/domain-error";
import { getCurrentUser } from "@/infrastructure/auth/rbac";
import { logger } from "@/infrastructure/observability/logger";
import { createErrorReporter } from "@/infrastructure/observability/error-reporter-factory";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/infrastructure/observability/request-id";
import { makeSubscribeToChannelUseCase, makeUnsubscribeFromChannelUseCase } from "@/application/use-cases/realtime/compose";
import { withApiTracing } from "@/infrastructure/tracing/http-tracing";

const channelActionSchema = z.object({
  connectionId: z.string().min(1),
  channel: z.string().min(1),
});

/**
 * Module 48 — Real-Time System.
 *
 * Dynamic channel management for an already-open realtime connection
 * (SSE or WebSocket) — lets a client subscribe to a channel it didn't
 * know about at connect time (e.g. opening a specific dispute thread
 * after navigating there) without tearing down and reopening its stream.
 * `connectionId` is the id returned in the SSE `connected` event /
 * WebSocket `connected` message.
 *
 * `POST` subscribes, `DELETE` unsubscribes. Both go through
 * `RealtimeHub` (via the CQRS use cases in
 * `application/use-cases/realtime/compose.ts`), so authorization is
 * enforced identically to the initial connect-time subscription.
 */
export const POST = withApiTracing("/api/realtime/channels", async function POST(request: NextRequest) {
  return handle(request, "subscribe");
});

export const DELETE = withApiTracing("/api/realtime/channels", async function DELETE(request: NextRequest) {
  return handle(request, "unsubscribe");
});

async function handle(request: NextRequest, action: "subscribe" | "unsubscribe") {
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
  const headers = { [REQUEST_ID_HEADER]: requestId };

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ status: "error", message: "Unauthorized." }, { status: 401, headers });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ status: "error", message: "Invalid JSON body." }, { status: 400, headers });
  }

  const parsed = channelActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ status: "error", message: "connectionId and channel are required." }, { status: 400, headers });
  }

  try {
    if (action === "subscribe") {
      const result = await makeSubscribeToChannelUseCase().execute(parsed.data);
      return NextResponse.json({ status: "ok", channel: result.channel }, { status: 200, headers });
    }
    makeUnsubscribeFromChannelUseCase().execute(parsed.data);
    return NextResponse.json({ status: "ok" }, { status: 200, headers });
  } catch (error) {
    if (error instanceof DomainError) {
      const status = error.code === "UNAUTHORIZED" ? 403 : 400;
      return NextResponse.json({ status: "error", message: error.message }, { status, headers });
    }
    logger.error("realtime_channel_action_failed", { requestId, route: "/api/realtime/channels", action, error });
    createErrorReporter().reportException(error, {
      tags: { route: "/api/realtime/channels", source: "http-route-handler" },
      extra: { requestId, action },
      user: { id: user.id },
    });
    return NextResponse.json({ status: "error", message: "Could not update channel subscription." }, { status: 500, headers });
  }
}
