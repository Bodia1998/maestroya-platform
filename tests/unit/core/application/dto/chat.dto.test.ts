import { describe, expect, it } from "vitest";

import { MAX_MESSAGE_LENGTH, openConversationSchema, sendMessageSchema } from "@/application/dto/chat.dto";

const CONVERSATION_ID = "123e4567-e89b-12d3-a456-426614174000";
const REQUEST_ID = "223e4567-e89b-12d3-a456-426614174000";
const PROFESSIONAL_ID = "323e4567-e89b-12d3-a456-426614174000";

describe("sendMessageSchema", () => {
  it("accepts a valid message", () => {
    const result = sendMessageSchema.safeParse({ conversationId: CONVERSATION_ID, body: "Hello there" });
    expect(result.success).toBe(true);
  });

  it("trims the body", () => {
    const result = sendMessageSchema.safeParse({ conversationId: CONVERSATION_ID, body: "  hi  " });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.body).toBe("hi");
  });

  it("rejects an empty body", () => {
    expect(sendMessageSchema.safeParse({ conversationId: CONVERSATION_ID, body: "" }).success).toBe(false);
  });

  it("rejects a body that is only whitespace", () => {
    expect(sendMessageSchema.safeParse({ conversationId: CONVERSATION_ID, body: "   " }).success).toBe(false);
  });

  it(`rejects a body longer than ${MAX_MESSAGE_LENGTH} characters`, () => {
    expect(
      sendMessageSchema.safeParse({ conversationId: CONVERSATION_ID, body: "a".repeat(MAX_MESSAGE_LENGTH + 1) })
        .success,
    ).toBe(false);
  });

  it("accepts a body of exactly the maximum length", () => {
    expect(
      sendMessageSchema.safeParse({ conversationId: CONVERSATION_ID, body: "a".repeat(MAX_MESSAGE_LENGTH) }).success,
    ).toBe(true);
  });

  it("rejects an invalid conversationId", () => {
    expect(sendMessageSchema.safeParse({ conversationId: "not-a-uuid", body: "hi" }).success).toBe(false);
  });
});

describe("openConversationSchema", () => {
  it("accepts a serviceRequestId with no professionalProfileId", () => {
    expect(openConversationSchema.safeParse({ serviceRequestId: REQUEST_ID }).success).toBe(true);
  });

  it("accepts a serviceRequestId with a professionalProfileId", () => {
    expect(
      openConversationSchema.safeParse({ serviceRequestId: REQUEST_ID, professionalProfileId: PROFESSIONAL_ID })
        .success,
    ).toBe(true);
  });

  it("rejects an invalid serviceRequestId", () => {
    expect(openConversationSchema.safeParse({ serviceRequestId: "not-a-uuid" }).success).toBe(false);
  });

  it("rejects an invalid professionalProfileId", () => {
    expect(
      openConversationSchema.safeParse({ serviceRequestId: REQUEST_ID, professionalProfileId: "not-a-uuid" })
        .success,
    ).toBe(false);
  });
});
