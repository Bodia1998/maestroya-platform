import { z } from "zod";

/**
 * Chat module. Same convention as quote.dto.ts/service-request.dto.ts: one
 * schema shared by the client composer form (via @hookform/resolvers/zod)
 * and the Server Action that receives it.
 *
 * `MAX_MESSAGE_LENGTH` is deliberately generous (long enough for a
 * paragraph or two) but bounded — an unbounded `body` would let a client
 * push arbitrarily large rows into the database. Trimming happens here so
 * "all whitespace" is rejected as empty rather than stored as a blank
 * bubble.
 */
export const MAX_MESSAGE_LENGTH = 4000;

export const sendMessageSchema = z.object({
  conversationId: z.string().uuid("Invalid conversation."),
  body: z
    .string()
    .trim()
    .min(1, "Write a message before sending.")
    .max(MAX_MESSAGE_LENGTH, `Messages must be ${MAX_MESSAGE_LENGTH} characters or fewer.`),
});
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const openConversationSchema = z.object({
  serviceRequestId: z.string().uuid("Invalid service request."),
  /** Only supplied by a customer opening a thread with a specific
   *  professional who quoted them — a professional opens a thread on their
   *  own ServiceRequest+Quote instead, with no counterparty to choose (see
   *  OpenConversationUseCase). */
  professionalProfileId: z.string().uuid("Invalid professional.").optional(),
});
export type OpenConversationInput = z.infer<typeof openConversationSchema>;
