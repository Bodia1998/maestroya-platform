import { NextResponse } from "next/server";

import { prisma } from "@/infrastructure/database/prisma/client";

/**
 * Health check endpoint for uptime monitoring / container orchestration
 * (e.g. a Vercel deployment check, a Kubernetes liveness probe, or an
 * external uptime monitor). Verifies the database connection is actually
 * reachable, not just that the process is running.
 */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;

    return NextResponse.json({ status: "ok", timestamp: new Date().toISOString() });
  } catch (error) {
    console.error("Health check failed:", error);

    return NextResponse.json(
      { status: "error", timestamp: new Date().toISOString() },
      { status: 503 },
    );
  }
}
