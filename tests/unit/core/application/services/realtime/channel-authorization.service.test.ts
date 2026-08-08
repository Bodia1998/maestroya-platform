import { describe, expect, it } from "vitest";

import { ChannelAuthorizationService } from "@/application/services/realtime/channel-authorization.service";
import { RealtimeChannel } from "@/domain/value-objects/realtime-channel";
import type { RealtimeAccessChecker } from "@/application/ports/realtime-access-checker";

class FakeAccessChecker implements RealtimeAccessChecker {
  constructor(private readonly allowed: Set<string> = new Set()) {}

  private ok(kind: string, userId: string, id: string): boolean {
    return this.allowed.has(`${kind}:${userId}:${id}`);
  }

  isJobParticipant(userId: string, jobId: string) {
    return Promise.resolve(this.ok("job", userId, jobId));
  }
  isDisputeParticipant(userId: string, disputeId: string) {
    return Promise.resolve(this.ok("dispute", userId, disputeId));
  }
  isConversationParticipant(userId: string, conversationId: string) {
    return Promise.resolve(this.ok("chat", userId, conversationId));
  }
  isCompanyMember(userId: string, companyProfileId: string) {
    return Promise.resolve(this.ok("company", userId, companyProfileId));
  }
  isProfessionalOwner(userId: string, professionalProfileId: string) {
    return Promise.resolve(this.ok("professional", userId, professionalProfileId));
  }
}

describe("application/services/realtime/channel-authorization.service", () => {
  it("allows only the owning user on their own user:{id} channel", async () => {
    const service = new ChannelAuthorizationService(new FakeAccessChecker());
    const owner = { userId: "u1", roles: ["CUSTOMER"] };
    const stranger = { userId: "u2", roles: ["CUSTOMER"] };

    expect(await service.canSubscribe(owner, RealtimeChannel.parse("user:u1"))).toBe(true);
    expect(await service.canSubscribe(stranger, RealtimeChannel.parse("user:u1"))).toBe(false);
  });

  it("allows staff roles onto any channel, including admin", async () => {
    const service = new ChannelAuthorizationService(new FakeAccessChecker());
    const admin = { userId: "admin-1", roles: ["ADMIN"] };

    expect(await service.canSubscribe(admin, RealtimeChannel.parse("admin"))).toBe(true);
    expect(await service.canSubscribe(admin, RealtimeChannel.parse("dispute:d1"))).toBe(true);
    expect(await service.canSubscribe(admin, RealtimeChannel.parse("user:someone-else"))).toBe(true);
  });

  it("denies a non-staff principal on the admin channel", async () => {
    const service = new ChannelAuthorizationService(new FakeAccessChecker());
    const customer = { userId: "u1", roles: ["CUSTOMER"] };
    expect(await service.canSubscribe(customer, RealtimeChannel.parse("admin"))).toBe(false);
  });

  it("defers to the access checker for resource channels", async () => {
    const checker = new FakeAccessChecker(new Set(["dispute:u1:d1", "chat:u1:c1", "company:u1:co1", "professional:u1:p1", "job:u1:j1"]));
    const service = new ChannelAuthorizationService(checker);
    const u1 = { userId: "u1", roles: ["CUSTOMER"] };
    const u2 = { userId: "u2", roles: ["CUSTOMER"] };

    expect(await service.canSubscribe(u1, RealtimeChannel.parse("dispute:d1"))).toBe(true);
    expect(await service.canSubscribe(u2, RealtimeChannel.parse("dispute:d1"))).toBe(false);
    expect(await service.canSubscribe(u1, RealtimeChannel.parse("chat:c1"))).toBe(true);
    expect(await service.canSubscribe(u1, RealtimeChannel.parse("company:co1"))).toBe(true);
    expect(await service.canSubscribe(u1, RealtimeChannel.parse("professional:p1"))).toBe(true);
    expect(await service.canSubscribe(u1, RealtimeChannel.parse("booking:j1"))).toBe(true);
    expect(await service.canSubscribe(u1, RealtimeChannel.parse("quote:j1"))).toBe(true);
    expect(await service.canSubscribe(u1, RealtimeChannel.parse("service-request:j1"))).toBe(true);
  });

  it("restricts operational channels (search-index, job-queue) to staff", async () => {
    const service = new ChannelAuthorizationService(new FakeAccessChecker());
    const customer = { userId: "u1", roles: ["CUSTOMER"] };
    const support = { userId: "s1", roles: ["SUPPORT"] };

    expect(await service.canSubscribe(customer, RealtimeChannel.parse("search-index:doc1"))).toBe(false);
    expect(await service.canSubscribe(support, RealtimeChannel.parse("job-queue:job1"))).toBe(true);
  });
});
