import { describe, expect, it, vi } from "vitest";

import { DeleteMessageUseCase } from "@/application/use-cases/chat/delete-message.use-case";
import { GetUnreadCountUseCase } from "@/application/use-cases/chat/get-unread-count.use-case";
import { ListConversationsUseCase } from "@/application/use-cases/chat/list-conversations.use-case";
import { ListMessagesUseCase } from "@/application/use-cases/chat/list-messages.use-case";
import { MarkConversationReadUseCase } from "@/application/use-cases/chat/mark-conversation-read.use-case";
import { OpenConversationUseCase } from "@/application/use-cases/chat/open-conversation.use-case";
import { SendMessageUseCase } from "@/application/use-cases/chat/send-message.use-case";
import type { ServiceRequestRecord } from "@/domain/repositories/service-request-repository";
import type { QuoteStatusValue } from "@/domain/repositories/quote-repository";
import {
  FakeConversationRepository,
  FakeCustomerProfileRepository,
  FakeDetectOffPlatformCommunicationUseCase,
  FakeMessageRepository,
  FakeProfessionalRepository,
  FakeQuoteRepository,
  FakeServiceRequestRepository,
  FakeTrustAutomatedActionRepository,
} from "./fakes";

/**
 * Integration tests for the Chat module's use cases — real use cases + real
 * domain services (conversation-state.ts), fake repositories swapped in for
 * storage. Follows the same pattern as
 * tests/integration/booking/booking-flows.test.ts.
 */

let requestIdCounter = 0;

function makeRepos() {
  const customerProfiles = new FakeCustomerProfileRepository();
  const professionals = new FakeProfessionalRepository();
  const serviceRequests = new FakeServiceRequestRepository();
  const quotes = new FakeQuoteRepository();
  const conversations = new FakeConversationRepository();
  const messages = new FakeMessageRepository(conversations);
  return { customerProfiles, professionals, serviceRequests, quotes, conversations, messages };
}

function useCases(repos: ReturnType<typeof makeRepos>) {
  return {
    openConversation: new OpenConversationUseCase(
      repos.customerProfiles,
      repos.professionals,
      repos.serviceRequests,
      repos.quotes,
      repos.conversations,
    ),
    sendMessage: new SendMessageUseCase(repos.conversations, repos.messages),
    listMessages: new ListMessagesUseCase(repos.conversations, repos.messages),
    listConversations: new ListConversationsUseCase(repos.conversations),
    markRead: new MarkConversationReadUseCase(repos.conversations),
    getUnreadCount: new GetUnreadCountUseCase(repos.conversations),
    deleteMessage: new DeleteMessageUseCase(repos.messages),
  };
}

async function seedRequest(
  repos: ReturnType<typeof makeRepos>,
  customerUserId: string,
): Promise<ServiceRequestRecord> {
  const customer = await repos.customerProfiles.findOrCreateByUserId(customerUserId);
  requestIdCounter += 1;
  const now = new Date();
  return repos.serviceRequests.seed({
    id: `request-${requestIdCounter}`,
    customerId: customer.id,
    categoryId: "cat-plumbing",
    categoryName: "Plumbing",
    title: "Fix leaking kitchen tap",
    description: "The tap under the kitchen sink has been dripping for a week.",
    status: "PUBLISHED",
    urgency: "MEDIUM",
    budgetMin: null,
    budgetMax: null,
    location: {
      line1: "Calle Mayor 1",
      line2: null,
      city: "Oliva",
      province: "Valencia",
      postalCode: "46780",
      country: "ES",
      latitude: null,
      longitude: null,
    },
    photos: [],
    createdAt: now,
    updatedAt: now,
  });
}

async function seedProfessionalWithQuote(
  repos: ReturnType<typeof makeRepos>,
  serviceRequestId: string,
  proUserId: string,
  status: QuoteStatusValue = "SENT",
) {
  const professional = repos.professionals.seed({ userId: proUserId });
  const quote = await repos.quotes.create({
    serviceRequestId,
    professionalProfileId: professional.id,
    submittedByUserId: proUserId,
    totalAmount: 100,
    currency: "EUR",
    validUntil: null,
    notes: null,
    items: [{ description: "Labor", quantity: 2, unitPrice: 50 }],
  });
  if (status !== "SENT") {
    await repos.quotes.updateStatus(quote.id, status);
  }
  return { professional, quote };
}

describe("Server Action auth boundary (unauthenticated users)", () => {
  // Mirrors booking-flows.test.ts's equivalent coverage for this module's
  // own Server Actions (openConversationAction/sendMessageAction/etc.),
  // which all call requireAuth() before ever touching a use case.
  it("requireAuth throws when there is no session", async () => {
    vi.doMock("@/lib/auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));
    const { requireAuth } = await import("@/infrastructure/auth/rbac");

    await expect(requireAuth()).rejects.toThrow();

    vi.doUnmock("@/lib/auth");
  });
});

describe("OpenConversationUseCase — eligibility", () => {
  it("lets the customer open a conversation with a professional who has quoted their request", async () => {
    const repos = makeRepos();
    const request = await seedRequest(repos, "cust-1");
    const { professional } = await seedProfessionalWithQuote(repos, request.id, "pro-1");

    const conversation = await useCases(repos).openConversation.execute("cust-1", request.id, professional.id);

    expect(conversation.serviceRequestId).toBe(request.id);
    expect(conversation.members.map((m) => m.userId).sort()).toEqual(["cust-1", "pro-1"].sort());
  });

  it("lets the professional open a conversation on a request they've quoted, without specifying a counterparty", async () => {
    const repos = makeRepos();
    const request = await seedRequest(repos, "cust-1");
    await seedProfessionalWithQuote(repos, request.id, "pro-1");

    const conversation = await useCases(repos).openConversation.execute("pro-1", request.id);

    expect(conversation.members.map((m) => m.userId).sort()).toEqual(["cust-1", "pro-1"].sort());
  });

  it("returns the existing conversation instead of creating a duplicate on a second call", async () => {
    const repos = makeRepos();
    const request = await seedRequest(repos, "cust-1");
    const { professional } = await seedProfessionalWithQuote(repos, request.id, "pro-1");

    const first = await useCases(repos).openConversation.execute("cust-1", request.id, professional.id);
    const second = await useCases(repos).openConversation.execute("cust-1", request.id, professional.id);
    const third = await useCases(repos).openConversation.execute("pro-1", request.id);

    expect(second.id).toBe(first.id);
    expect(third.id).toBe(first.id);
    expect(repos.conversations.conversations.size).toBe(1);
  });

  it("rejects a customer who doesn't specify which professional to message", async () => {
    const repos = makeRepos();
    const request = await seedRequest(repos, "cust-1");
    await seedProfessionalWithQuote(repos, request.id, "pro-1");

    await expect(useCases(repos).openConversation.execute("cust-1", request.id)).rejects.toThrow();
  });

  it("rejects a customer trying to message a professional who has never quoted this request", async () => {
    const repos = makeRepos();
    const request = await seedRequest(repos, "cust-1");
    const uninvolvedPro = repos.professionals.seed({ userId: "pro-2" });

    await expect(
      useCases(repos).openConversation.execute("cust-1", request.id, uninvolvedPro.id),
    ).rejects.toThrow();
  });

  it("rejects a professional trying to open a conversation on a request they haven't quoted", async () => {
    const repos = makeRepos();
    const request = await seedRequest(repos, "cust-1");
    repos.professionals.seed({ userId: "pro-1" });

    await expect(useCases(repos).openConversation.execute("pro-1", request.id)).rejects.toThrow();
  });

  it("rejects a signed-in user with no relationship to the request at all", async () => {
    const repos = makeRepos();
    const request = await seedRequest(repos, "cust-1");
    await seedProfessionalWithQuote(repos, request.id, "pro-1");

    await expect(useCases(repos).openConversation.execute("stranger-1", request.id)).rejects.toThrow();
  });

  it("rejects a different customer trying to message a professional on someone else's request", async () => {
    const repos = makeRepos();
    const request = await seedRequest(repos, "cust-1");
    const { professional } = await seedProfessionalWithQuote(repos, request.id, "pro-1");
    await repos.customerProfiles.findOrCreateByUserId("cust-2");

    await expect(
      useCases(repos).openConversation.execute("cust-2", request.id, professional.id),
    ).rejects.toThrow();
  });

  it.each(["WITHDRAWN", "REJECTED", "ACCEPTED"] as const)(
    "still allows opening a conversation once the quote is %s (chat access outlives quote status)",
    async (status) => {
      const repos = makeRepos();
      const request = await seedRequest(repos, "cust-1");
      const { professional } = await seedProfessionalWithQuote(repos, request.id, "pro-1", status);

      const conversation = await useCases(repos).openConversation.execute("cust-1", request.id, professional.id);
      expect(conversation.id).toBeDefined();
    },
  );

  it("does not create a second conversation for a second professional on the same request", async () => {
    const repos = makeRepos();
    const request = await seedRequest(repos, "cust-1");
    const { professional: pro1 } = await seedProfessionalWithQuote(repos, request.id, "pro-1");
    const { professional: pro2 } = await seedProfessionalWithQuote(repos, request.id, "pro-2");

    const conv1 = await useCases(repos).openConversation.execute("cust-1", request.id, pro1.id);
    const conv2 = await useCases(repos).openConversation.execute("cust-1", request.id, pro2.id);

    expect(conv1.id).not.toBe(conv2.id);
    expect(repos.conversations.conversations.size).toBe(2);
  });
});

describe("SendMessageUseCase — authorization and IDOR protection", () => {
  it("lets a member send a message", async () => {
    const repos = makeRepos();
    const request = await seedRequest(repos, "cust-1");
    const { professional } = await seedProfessionalWithQuote(repos, request.id, "pro-1");
    const conversation = await useCases(repos).openConversation.execute("cust-1", request.id, professional.id);

    const message = await useCases(repos).sendMessage.execute("cust-1", conversation.id, "Hi, is Tuesday ok?");

    expect(message.body).toBe("Hi, is Tuesday ok?");
    expect(message.senderId).toBe("cust-1");
    expect((await repos.conversations.findById(conversation.id))?.lastMessageAt).not.toBeNull();
  });

  it("rejects a user who is not a member of the conversation (IDOR)", async () => {
    const repos = makeRepos();
    const request = await seedRequest(repos, "cust-1");
    const { professional } = await seedProfessionalWithQuote(repos, request.id, "pro-1");
    const conversation = await useCases(repos).openConversation.execute("cust-1", request.id, professional.id);

    await expect(
      useCases(repos).sendMessage.execute("stranger-1", conversation.id, "let me in"),
    ).rejects.toThrow();
  });

  it("rejects a nonexistent conversation id the same way as an unauthorized one", async () => {
    const repos = makeRepos();
    await expect(
      useCases(repos).sendMessage.execute("cust-1", "does-not-exist", "hi"),
    ).rejects.toThrow();
  });

  it("rejects an empty or whitespace-only message", async () => {
    const repos = makeRepos();
    const request = await seedRequest(repos, "cust-1");
    const { professional } = await seedProfessionalWithQuote(repos, request.id, "pro-1");
    const conversation = await useCases(repos).openConversation.execute("cust-1", request.id, professional.id);

    await expect(useCases(repos).sendMessage.execute("cust-1", conversation.id, "   ")).rejects.toThrow();
  });

  it("rejects sending into a non-ACTIVE conversation", async () => {
    const repos = makeRepos();
    const request = await seedRequest(repos, "cust-1");
    const { professional } = await seedProfessionalWithQuote(repos, request.id, "pro-1");
    const conversation = await useCases(repos).openConversation.execute("cust-1", request.id, professional.id);

    const closed = { ...(await repos.conversations.findById(conversation.id))!, status: "CLOSED" as const };
    repos.conversations.conversations.set(conversation.id, closed);

    await expect(
      useCases(repos).sendMessage.execute("cust-1", conversation.id, "still there?"),
    ).rejects.toThrow();
  });

  it("still allows sending after the quote that established the relationship is withdrawn", async () => {
    const repos = makeRepos();
    const request = await seedRequest(repos, "cust-1");
    const { professional, quote } = await seedProfessionalWithQuote(repos, request.id, "pro-1");
    const conversation = await useCases(repos).openConversation.execute("cust-1", request.id, professional.id);
    await repos.quotes.updateStatus(quote.id, "WITHDRAWN");

    const message = await useCases(repos).sendMessage.execute("pro-1", conversation.id, "Sorry, had to withdraw.");
    expect(message.senderId).toBe("pro-1");
  });
});

describe("SendMessageUseCase — Module 89 trust signal activation", () => {
  it("blocks sending when the sender has an ACTIVE MESSAGING_RESTRICTION", async () => {
    const repos = makeRepos();
    const request = await seedRequest(repos, "cust-1");
    const { professional } = await seedProfessionalWithQuote(repos, request.id, "pro-1");
    const conversation = await useCases(repos).openConversation.execute("cust-1", request.id, professional.id);
    const trustAutomatedActions = new FakeTrustAutomatedActionRepository();
    trustAutomatedActions.seedActive("cust-1", "MESSAGING_RESTRICTION");
    const sendMessage = new SendMessageUseCase(repos.conversations, repos.messages, undefined, trustAutomatedActions);

    await expect(sendMessage.execute("cust-1", conversation.id, "call me at 555-0100")).rejects.toThrow(
      /messaging restriction/i,
    );

    // No message was persisted — the restriction blocks the write itself.
    expect(await repos.messages.listByConversation(conversation.id, { limit: 10 })).toHaveLength(0);
  });

  it("does not block a restriction of a different type (e.g. BOOKING_RESTRICTION)", async () => {
    const repos = makeRepos();
    const request = await seedRequest(repos, "cust-1");
    const { professional } = await seedProfessionalWithQuote(repos, request.id, "pro-1");
    const conversation = await useCases(repos).openConversation.execute("cust-1", request.id, professional.id);
    const trustAutomatedActions = new FakeTrustAutomatedActionRepository();
    trustAutomatedActions.seedActive("cust-1", "BOOKING_RESTRICTION");
    const sendMessage = new SendMessageUseCase(repos.conversations, repos.messages, undefined, trustAutomatedActions);

    const message = await sendMessage.execute("cust-1", conversation.id, "still there?");
    expect(message.senderId).toBe("cust-1");
  });

  it("runs off-platform detection on every sent message", async () => {
    const repos = makeRepos();
    const request = await seedRequest(repos, "cust-1");
    const { professional } = await seedProfessionalWithQuote(repos, request.id, "pro-1");
    const conversation = await useCases(repos).openConversation.execute("cust-1", request.id, professional.id);
    const offPlatformDetection = new FakeDetectOffPlatformCommunicationUseCase();
    const sendMessage = new SendMessageUseCase(repos.conversations, repos.messages, undefined, undefined, offPlatformDetection);

    const message = await sendMessage.execute("cust-1", conversation.id, "call me at 555-0100");

    expect(offPlatformDetection.calls).toHaveLength(1);
    expect(offPlatformDetection.calls[0]).toMatchObject({
      userId: "cust-1",
      text: "call me at 555-0100",
      sourceType: "MESSAGE",
      sourceId: message.id,
    });
  });

  it("a detection failure never fails or undoes the send (best-effort)", async () => {
    const repos = makeRepos();
    const request = await seedRequest(repos, "cust-1");
    const { professional } = await seedProfessionalWithQuote(repos, request.id, "pro-1");
    const conversation = await useCases(repos).openConversation.execute("cust-1", request.id, professional.id);
    const offPlatformDetection = new FakeDetectOffPlatformCommunicationUseCase();
    offPlatformDetection.shouldThrow = true;
    const sendMessage = new SendMessageUseCase(repos.conversations, repos.messages, undefined, undefined, offPlatformDetection);

    const message = await sendMessage.execute("cust-1", conversation.id, "hello there");

    expect(message.body).toBe("hello there");
    expect(await repos.messages.listByConversation(conversation.id, { limit: 10 })).toHaveLength(1);
  });

  it("still works when neither trustAutomatedActions nor offPlatformDetection is supplied (backward compatible)", async () => {
    const repos = makeRepos();
    const request = await seedRequest(repos, "cust-1");
    const { professional } = await seedProfessionalWithQuote(repos, request.id, "pro-1");
    const conversation = await useCases(repos).openConversation.execute("cust-1", request.id, professional.id);

    const message = await useCases(repos).sendMessage.execute("cust-1", conversation.id, "hi there");
    expect(message.body).toBe("hi there");
  });
});

describe("ListMessagesUseCase — authorization and ordering", () => {
  it("returns messages in chronological order", async () => {
    const repos = makeRepos();
    const request = await seedRequest(repos, "cust-1");
    const { professional } = await seedProfessionalWithQuote(repos, request.id, "pro-1");
    const conversation = await useCases(repos).openConversation.execute("cust-1", request.id, professional.id);

    await useCases(repos).sendMessage.execute("cust-1", conversation.id, "first");
    await useCases(repos).sendMessage.execute("pro-1", conversation.id, "second");
    await useCases(repos).sendMessage.execute("cust-1", conversation.id, "third");

    const messages = await useCases(repos).listMessages.execute("cust-1", conversation.id);
    expect(messages.map((m) => m.body)).toEqual(["first", "second", "third"]);
  });

  it("rejects a non-member reading the conversation (IDOR)", async () => {
    const repos = makeRepos();
    const request = await seedRequest(repos, "cust-1");
    const { professional } = await seedProfessionalWithQuote(repos, request.id, "pro-1");
    const conversation = await useCases(repos).openConversation.execute("cust-1", request.id, professional.id);
    await useCases(repos).sendMessage.execute("cust-1", conversation.id, "private");

    await expect(useCases(repos).listMessages.execute("stranger-1", conversation.id)).rejects.toThrow();
  });

  it("still lets a member read a CLOSED conversation's history", async () => {
    const repos = makeRepos();
    const request = await seedRequest(repos, "cust-1");
    const { professional } = await seedProfessionalWithQuote(repos, request.id, "pro-1");
    const conversation = await useCases(repos).openConversation.execute("cust-1", request.id, professional.id);
    await useCases(repos).sendMessage.execute("cust-1", conversation.id, "before close");

    const closed = { ...(await repos.conversations.findById(conversation.id))!, status: "CLOSED" as const };
    repos.conversations.conversations.set(conversation.id, closed);

    const messages = await useCases(repos).listMessages.execute("cust-1", conversation.id);
    expect(messages).toHaveLength(1);
  });

  it("includes soft-deleted messages (for placeholder rendering) rather than omitting them", async () => {
    const repos = makeRepos();
    const request = await seedRequest(repos, "cust-1");
    const { professional } = await seedProfessionalWithQuote(repos, request.id, "pro-1");
    const conversation = await useCases(repos).openConversation.execute("cust-1", request.id, professional.id);
    const message = await useCases(repos).sendMessage.execute("cust-1", conversation.id, "oops");

    await useCases(repos).deleteMessage.execute("cust-1", message.id);

    const messages = await useCases(repos).listMessages.execute("cust-1", conversation.id);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.status).toBe("DELETED");
  });
});

describe("DeleteMessageUseCase — ownership", () => {
  it("lets the sender delete their own message", async () => {
    const repos = makeRepos();
    const request = await seedRequest(repos, "cust-1");
    const { professional } = await seedProfessionalWithQuote(repos, request.id, "pro-1");
    const conversation = await useCases(repos).openConversation.execute("cust-1", request.id, professional.id);
    const message = await useCases(repos).sendMessage.execute("cust-1", conversation.id, "oops");

    await useCases(repos).deleteMessage.execute("cust-1", message.id);

    expect((await repos.messages.findById(message.id))?.status).toBe("DELETED");
  });

  it("rejects deleting another member's message", async () => {
    const repos = makeRepos();
    const request = await seedRequest(repos, "cust-1");
    const { professional } = await seedProfessionalWithQuote(repos, request.id, "pro-1");
    const conversation = await useCases(repos).openConversation.execute("cust-1", request.id, professional.id);
    const message = await useCases(repos).sendMessage.execute("cust-1", conversation.id, "hello");

    await expect(useCases(repos).deleteMessage.execute("pro-1", message.id)).rejects.toThrow();
    expect((await repos.messages.findById(message.id))?.status).toBe("SENT");
  });

  it("rejects deleting a nonexistent message", async () => {
    const repos = makeRepos();
    await expect(useCases(repos).deleteMessage.execute("cust-1", "does-not-exist")).rejects.toThrow();
  });
});

describe("Unread state", () => {
  it("counts messages from the other participant as unread until marked read", async () => {
    const repos = makeRepos();
    const request = await seedRequest(repos, "cust-1");
    const { professional } = await seedProfessionalWithQuote(repos, request.id, "pro-1");
    const conversation = await useCases(repos).openConversation.execute("cust-1", request.id, professional.id);

    await useCases(repos).sendMessage.execute("pro-1", conversation.id, "hello");
    await useCases(repos).sendMessage.execute("pro-1", conversation.id, "you there?");

    expect(await useCases(repos).getUnreadCount.execute("cust-1")).toBe(2);

    const [summary] = await useCases(repos).listConversations.execute("cust-1");
    expect(summary?.unreadCount).toBe(2);

    await useCases(repos).markRead.execute("cust-1", conversation.id);

    expect(await useCases(repos).getUnreadCount.execute("cust-1")).toBe(0);
  });

  it("never counts the caller's own messages as unread", async () => {
    const repos = makeRepos();
    const request = await seedRequest(repos, "cust-1");
    const { professional } = await seedProfessionalWithQuote(repos, request.id, "pro-1");
    const conversation = await useCases(repos).openConversation.execute("cust-1", request.id, professional.id);

    await useCases(repos).sendMessage.execute("cust-1", conversation.id, "hello");

    expect(await useCases(repos).getUnreadCount.execute("cust-1")).toBe(0);
  });

  it("rejects marking a conversation read for a non-member", async () => {
    const repos = makeRepos();
    const request = await seedRequest(repos, "cust-1");
    const { professional } = await seedProfessionalWithQuote(repos, request.id, "pro-1");
    const conversation = await useCases(repos).openConversation.execute("cust-1", request.id, professional.id);

    await expect(useCases(repos).markRead.execute("stranger-1", conversation.id)).rejects.toThrow();
  });
});

describe("ListConversationsUseCase", () => {
  it("only returns conversations the caller belongs to", async () => {
    const repos = makeRepos();
    const requestA = await seedRequest(repos, "cust-1");
    const { professional: proA } = await seedProfessionalWithQuote(repos, requestA.id, "pro-1");
    await useCases(repos).openConversation.execute("cust-1", requestA.id, proA.id);

    const requestB = await seedRequest(repos, "cust-2");
    const { professional: proB } = await seedProfessionalWithQuote(repos, requestB.id, "pro-2");
    await useCases(repos).openConversation.execute("cust-2", requestB.id, proB.id);

    const custOneConversations = await useCases(repos).listConversations.execute("cust-1");
    expect(custOneConversations).toHaveLength(1);
    expect(custOneConversations[0]?.otherParticipant.userId).toBe("pro-1");

    const strangerConversations = await useCases(repos).listConversations.execute("stranger-1");
    expect(strangerConversations).toHaveLength(0);
  });
});
