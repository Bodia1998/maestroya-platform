import { describe, expect, it } from "vitest";

import { InvalidRealtimeChannelError, RealtimeChannel } from "@/domain/value-objects/realtime-channel";

describe("domain/value-objects/realtime-channel", () => {
  it("parses a resource channel into type + resourceId", () => {
    const channel = RealtimeChannel.parse("dispute:abc-123");
    expect(channel.type).toBe("dispute");
    expect(channel.resourceId).toBe("abc-123");
    expect(channel.toString()).toBe("dispute:abc-123");
  });

  it("parses the singleton admin channel with no resource id", () => {
    const channel = RealtimeChannel.parse("admin");
    expect(channel.type).toBe("admin");
    expect(channel.resourceId).toBeNull();
    expect(channel.toString()).toBe("admin");
  });

  it("rejects an unknown channel type", () => {
    expect(() => RealtimeChannel.parse("carrier-pigeon:1")).toThrow(InvalidRealtimeChannelError);
  });

  it("rejects a resource channel with no id", () => {
    expect(() => RealtimeChannel.parse("dispute")).toThrow(InvalidRealtimeChannelError);
  });

  it("rejects a singleton channel that was given a resource id", () => {
    expect(() => RealtimeChannel.parse("admin:123")).toThrow(InvalidRealtimeChannelError);
  });

  it("rejects an empty or malformed string", () => {
    expect(() => RealtimeChannel.parse("")).toThrow(InvalidRealtimeChannelError);
    expect(() => RealtimeChannel.parse("Dispute:123")).toThrow(InvalidRealtimeChannelError);
  });

  it("isValid reports validity without throwing", () => {
    expect(RealtimeChannel.isValid("user:1")).toBe(true);
    expect(RealtimeChannel.isValid("nope")).toBe(false);
  });

  it("of() builds the same result as parse()", () => {
    expect(RealtimeChannel.of("chat", "42").toString()).toBe(RealtimeChannel.parse("chat:42").toString());
    expect(RealtimeChannel.of("admin").toString()).toBe("admin");
  });

  it("equals() compares by value", () => {
    expect(RealtimeChannel.parse("user:1").equals(RealtimeChannel.parse("user:1"))).toBe(true);
    expect(RealtimeChannel.parse("user:1").equals(RealtimeChannel.parse("user:2"))).toBe(false);
  });

  it("isPrivateResourceChannel is true only for user/professional/company", () => {
    expect(RealtimeChannel.parse("user:1").isPrivateResourceChannel).toBe(true);
    expect(RealtimeChannel.parse("professional:1").isPrivateResourceChannel).toBe(true);
    expect(RealtimeChannel.parse("company:1").isPrivateResourceChannel).toBe(true);
    expect(RealtimeChannel.parse("dispute:1").isPrivateResourceChannel).toBe(false);
    expect(RealtimeChannel.parse("admin").isPrivateResourceChannel).toBe(false);
  });
});
