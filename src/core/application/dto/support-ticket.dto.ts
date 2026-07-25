import { z } from "zod";

import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, MAX_RESOLUTION_NOTE_LENGTH } from "@/domain/services/dispute-rules";

/** Module 21 — Disputes & Support: SupportTicket DTOs — same conventions as
 *  dispute.dto.ts. */

const SUPPORT_TICKET_CATEGORY_VALUES = ["ACCOUNT", "VERIFICATION", "BUG", "LOGIN", "GENERAL", "OTHER"] as const;
const SUPPORT_TICKET_STATUS_VALUES = ["OPEN", "IN_PROGRESS", "WAITING_FOR_USER", "RESOLVED", "CLOSED"] as const;
const SUPPORT_TICKET_PRIORITY_VALUES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  offset: z.coerce.number().int().min(0).default(0),
});

export const createSupportTicketSchema = z.object({
  category: z.enum(SUPPORT_TICKET_CATEGORY_VALUES),
  subject: z.string().trim().min(5, "Subject must be at least 5 characters.").max(150),
  description: z.string().trim().min(10, "Description must be at least 10 characters.").max(5000),
});
export type CreateSupportTicketInput = z.infer<typeof createSupportTicketSchema>;

export const getSupportTicketSchema = z.object({ ticketId: z.string().uuid("Invalid ticket.") });
export type GetSupportTicketInput = z.infer<typeof getSupportTicketSchema>;

export const listMySupportTicketsSchema = paginationSchema.extend({
  status: z.enum(SUPPORT_TICKET_STATUS_VALUES).optional(),
});
export type ListMySupportTicketsInput = z.infer<typeof listMySupportTicketsSchema>;

export const listAdminSupportTicketsSchema = paginationSchema.extend({
  status: z.enum(SUPPORT_TICKET_STATUS_VALUES).optional(),
  priority: z.enum(SUPPORT_TICKET_PRIORITY_VALUES).optional(),
  category: z.enum(SUPPORT_TICKET_CATEGORY_VALUES).optional(),
  assignedAdminUserId: z.string().uuid().optional(),
  search: z.string().trim().max(100).optional(),
});
export type ListAdminSupportTicketsInput = z.infer<typeof listAdminSupportTicketsSchema>;

export const assignSupportTicketSchema = z.object({
  ticketId: z.string().uuid("Invalid ticket."),
  adminUserId: z.string().uuid("Invalid admin.").nullable(),
});
export type AssignSupportTicketInput = z.infer<typeof assignSupportTicketSchema>;

export const changeSupportTicketStatusSchema = z.object({
  ticketId: z.string().uuid("Invalid ticket."),
  status: z.enum(SUPPORT_TICKET_STATUS_VALUES),
});
export type ChangeSupportTicketStatusInput = z.infer<typeof changeSupportTicketStatusSchema>;

export const resolveSupportTicketSchema = z.object({
  ticketId: z.string().uuid("Invalid ticket."),
  resolutionNote: z
    .string()
    .trim()
    .min(1, "Resolution note is required.")
    .max(MAX_RESOLUTION_NOTE_LENGTH, `Resolution note must be ${MAX_RESOLUTION_NOTE_LENGTH} characters or fewer.`),
});
export type ResolveSupportTicketInput = z.infer<typeof resolveSupportTicketSchema>;

export const closeSupportTicketSchema = z.object({ ticketId: z.string().uuid("Invalid ticket.") });
export type CloseSupportTicketInput = z.infer<typeof closeSupportTicketSchema>;
