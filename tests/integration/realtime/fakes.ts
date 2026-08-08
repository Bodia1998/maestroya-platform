import { vi } from "vitest";

import type { RealtimeAccessChecker } from "@/application/ports/realtime-access-checker";
import type { RealtimeSink } from "@/application/ports/realtime-registry";

/**
 * Module 48 — Real-Time System integration test fakes, shared across
 * `tests/integration/realtime/*.test.ts` — mirrors
 * `tests/integration/notification/fakes.ts`'s own "one fakes.ts per
 * integration-tested module" convention.
 */
export class RecordingAccessChecker implements RealtimeAccessChecker {
  constructor(private readonly allowed: Set<string> = new Set()) {}

  allow(kind: "job" | "dispute" | "chat" | "company" | "professional", userId: string, resourceId: string): void {
    this.allowed.add(`${kind}:${userId}:${resourceId}`);
  }

  isJobParticipant(userId: string, jobId: string): Promise<boolean> {
    return Promise.resolve(this.allowed.has(`job:${userId}:${jobId}`));
  }
  isDisputeParticipant(userId: string, disputeId: string): Promise<boolean> {
    return Promise.resolve(this.allowed.has(`dispute:${userId}:${disputeId}`));
  }
  isConversationParticipant(userId: string, conversationId: string): Promise<boolean> {
    return Promise.resolve(this.allowed.has(`chat:${userId}:${conversationId}`));
  }
  isCompanyMember(userId: string, companyProfileId: string): Promise<boolean> {
    return Promise.resolve(this.allowed.has(`company:${userId}:${companyProfileId}`));
  }
  isProfessionalOwner(userId: string, professionalProfileId: string): Promise<boolean> {
    return Promise.resolve(this.allowed.has(`professional:${userId}:${professionalProfileId}`));
  }
}

export function recordingSink(): { sink: RealtimeSink; received: unknown[]; closeReasons: (string | undefined)[] } {
  const received: unknown[] = [];
  const closeReasons: (string | undefined)[] = [];
  return {
    received,
    closeReasons,
    sink: {
      send: vi.fn((event) => received.push(event)),
      close: vi.fn((reason?: string) => {
        closeReasons.push(reason);
      }),
    },
  };
}
