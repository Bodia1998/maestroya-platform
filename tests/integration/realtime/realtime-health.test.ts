import { beforeEach, describe, expect, it, vi } from "vitest";

// `infrastructure/realtime/compose.ts` eagerly constructs
// `PrismaRealtimeAccessChecker` from the real Prisma repositories at
// module load, exactly like every other `compose.ts` in this codebase
// (see e.g. `application/use-cases/dispute/compose.ts`'s own
// `new PrismaDisputeRepository()` at module scope). That eager
// construction is fine in a real process (Prisma connects lazily), but
// merely *importing* `@prisma/client` is enough to attempt query-engine
// binary resolution — something this suite must never depend on
// succeeding, since `getRealtimeHealth()`/`RealtimeHub` never actually
// touch the database (only `ChannelAuthorizationService.canSubscribe`
// does, which this file doesn't exercise — that path is covered against a
// fake `RealtimeAccessChecker` in `realtime-flows.test.ts` and
// `channel-authorization.service.test.ts` instead). Mocking the five
// Prisma repository modules keeps this suite a true integration test of
// the actual composition root's wiring (registry/presence/metrics/hub are
// all real) without a database or a matching-platform query engine binary
// being a hidden test dependency.
vi.mock("@/infrastructure/database/prisma/repositories/prisma-job-repository", () => ({ PrismaJobRepository: class {} }));
vi.mock("@/infrastructure/database/prisma/repositories/prisma-customer-profile-repository", () => ({ PrismaCustomerProfileRepository: class {} }));
vi.mock("@/infrastructure/database/prisma/repositories/prisma-professional-repository", () => ({ PrismaProfessionalRepository: class {} }));
vi.mock("@/infrastructure/database/prisma/repositories/prisma-company-membership-repository", () => ({ PrismaCompanyMembershipRepository: class {} }));
vi.mock("@/infrastructure/database/prisma/repositories/prisma-dispute-repository", () => ({ PrismaDisputeRepository: class {} }));
vi.mock("@/infrastructure/database/prisma/repositories/prisma-conversation-repository", () => ({ PrismaConversationRepository: class {} }));

const { getRealtimeHealth, realtimeHub, __testing } = await import("@/infrastructure/realtime/compose");

/**
 * Exercises the real, wired singleton (`infrastructure/realtime/compose.ts`)
 * rather than a hand-built stack — this is what `/api/health/ready`
 * actually calls, so it is worth covering against the real composition
 * root rather than only against fakes.
 */
describe("realtime integration: health reporting", () => {
  beforeEach(() => {
    // The singletons in compose.ts are process-wide; clear connection/
    // presence/metrics state between tests so counts don't leak across
    // this file's own test cases.
    for (const connection of __testing.registry.list()) {
      realtimeHub.disconnect(connection.id);
    }
  });

  it("reports zero active connections/channels when nothing is connected", () => {
    const report = getRealtimeHealth();
    expect(report.status).toBe("ok");
    expect(report.transports.sse).toBe("ok");
    expect(report.activeConnections).toBe(0);
    expect(report.activeChannels).toBe(0);
  });

  it("reflects a live connection and its channel", () => {
    const connection = realtimeHub.connect({
      userId: "u1",
      roles: ["CUSTOMER"],
      transport: "SSE",
      sink: { send: () => {}, close: () => {} },
    });

    const report = getRealtimeHealth();
    expect(report.activeConnections).toBe(1);
    expect(report.onlineUsers).toBe(1);

    realtimeHub.disconnect(connection.id);
    expect(getRealtimeHealth().activeConnections).toBe(0);
  });

  it("reports websocket transport as not_configured by default (REALTIME_WS_ENABLED unset)", () => {
    expect(getRealtimeHealth().transports.websocket).toBe("not_configured");
  });
});
