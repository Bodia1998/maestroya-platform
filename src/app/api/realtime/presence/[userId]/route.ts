import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { DomainError } from "@/domain/errors/domain-error";
import { getCurrentUser } from "@/infrastructure/auth/rbac";
import { logger } from "@/infrastructure/observability/logger";
import { createErrorReporter } from "@/infrastructure/observability/error-reporter-factory";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/infrastructure/observability/request-id";
import { makeGetPresenceUseCase } from "@/application/use-cases/realtime/compose";

/**
 * Module 48 — Real-Time System.
 *
 * Presence read endpoint — online/offline, active device count, last
 * seen. Self-or-staff only, enforced by `GetPresenceUseCase` itself (see
 * that use case's own doc comment); this route only translates its
 * result/errors to HTTP, the same thin-route-handler convention every
 * other route in this codebase follows.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
  const headers = { [REQUEST_ID_HEADER]: requestId };
  const { userId } = await params;

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ status: "error", message: "Unauthorized." }, { status: 401, headers });
  }

  try {
    const presence = makeGetPresenceUseCase().execute({
      requestedByUserId: user.id,
      requestedByRoles: user.roles,
      targetUserId: userId,
    });
    return NextResponse.json({ status: "ok", presence }, { status: 200, headers });
  } catch (error) {
    if (error instanceof DomainError) {
      const status = error.code === "UNAUTHORIZED" ? 403 : 400;
      return NextResponse.json({ status: "error", message: error.message }, { status, headers });
    }
    logger.error("realtime_presence_lookup_failed", { requestId, route: "/api/realtime/presence/[userId]", error });
    createErrorReporter().reportException(error, {
      tags: { route: "/api/realtime/presence/[userId]", source: "http-route-handler" },
      extra: { requestId, targetUserId: userId },
      user: { id: user.id },
    });
    return NextResponse.json({ status: "error", message: "Could not load presence." }, { status: 500, headers });
  }
}
