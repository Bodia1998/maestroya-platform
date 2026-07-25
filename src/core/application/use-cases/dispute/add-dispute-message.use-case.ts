import { NullNotificationCreator } from "@/application/ports/notification-creator";
import type { NotificationCreator } from "@/application/ports/notification-creator";
import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { DisputeRepository } from "@/domain/repositories/dispute-repository";
import type { DisputeMessageRecord, DisputeMessageRepository } from "@/domain/repositories/dispute-message-repository";
import type { JobRepository } from "@/domain/repositories/job-repository";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { CompanyMembershipRepository } from "@/domain/repositories/company-membership-repository";
import { resolveDisputeActor } from "@/application/use-cases/dispute/resolve-dispute-actor";
import { isTerminalStatus, isWaitingOnResponse } from "@/domain/services/dispute-state";

/**
 * Module 21 — Disputes & Support: posts a public message on a Dispute's
 * thread — the customer, professional/company, or an admin may post
 * (admins post through this same use case with `isAdminCaller: true`, which
 * skips resolveDisputeActor's ownership check and reuses the same
 * "requireRole trusted at the boundary" convention as every other admin
 * use case). Never creates an internal note — see
 * AddDisputeInternalNoteUseCase for that separate, admin-only path.
 *
 * Business rule: if the dispute is currently WAITING_FOR_CUSTOMER/
 * WAITING_FOR_PROFESSIONAL and the message's author is the party being
 * waited on, the dispute auto-transitions back to UNDER_REVIEW — "the
 * requested party responded" is exactly what ends the waiting state. An
 * admin posting a message never triggers this auto-transition (an admin
 * commenting isn't "the response" being waited for).
 */
export class AddDisputeMessageUseCase {
  constructor(
    private readonly disputes: DisputeRepository,
    private readonly disputeMessages: DisputeMessageRepository,
    private readonly jobs: JobRepository,
    private readonly customerProfiles: CustomerProfileRepository,
    private readonly professionals: ProfessionalRepository,
    private readonly companyMembers: CompanyMembershipRepository,
    private readonly auditLog: AdminAuditLogRepository,
    private readonly notifications: NotificationCreator = new NullNotificationCreator(),
  ) {}

  async execute(
    userId: string,
    disputeId: string,
    body: string,
    options: { isAdminCaller?: boolean } = {},
  ): Promise<DisputeMessageRecord> {
    const dispute = await this.disputes.findById(disputeId);
    if (!dispute) {
      throw new NotFoundError("Dispute", disputeId);
    }

    if (isTerminalStatus(dispute.status)) {
      throw new ValidationError("This dispute is closed and no longer accepts new messages.");
    }

    const job = await this.jobs.findById(dispute.jobId);
    if (!job) {
      throw new NotFoundError("Dispute", disputeId);
    }

    let actorRole: "customer" | "professional" | "company" | "admin" = "admin";
    if (!options.isAdminCaller) {
      const actor = await resolveDisputeActor(userId, dispute, job, {
        customerProfiles: this.customerProfiles,
        professionals: this.professionals,
        companyMembers: this.companyMembers,
      });
      actorRole = actor.role;
    }

    const message = await this.disputeMessages.create({ disputeId, authorUserId: userId, body, isInternalNote: false });

    try {
      await this.auditLog.record({
        adminUserId: userId,
        action: "DISPUTE_MESSAGE_ADDED",
        targetType: "Dispute",
        targetId: disputeId,
        // No message body in metadata — messages are already visible in
        // the dispute thread itself; the audit trail only needs to record
        // that a message happened and who added it (see the module spec's
        // "do not log sensitive data unnecessarily" requirement).
        metadata: { messageId: message.id },
      });
    } catch (error) {
      console.error("Failed to record dispute-message-added audit log", error);
    }

    // Auto-transition: the waited-on party responded.
    if (
      isWaitingOnResponse(dispute.status) &&
      ((dispute.status === "WAITING_FOR_CUSTOMER" && actorRole === "customer") ||
        (dispute.status === "WAITING_FOR_PROFESSIONAL" && (actorRole === "professional" || actorRole === "company")))
    ) {
      try {
        await this.disputes.updateStatus(disputeId, dispute.status, { status: "UNDER_REVIEW" });
      } catch (error) {
        // A lost race here (status already changed concurrently) is not
        // fatal to message posting — the message itself was already saved
        // successfully.
        console.error("Failed to auto-transition dispute status after a party response", error);
      }
    }

    try {
      const recipientUserIds = new Set<string>();
      if (dispute.raisedByUserId !== userId) recipientUserIds.add(dispute.raisedByUserId);
      const customer = await this.customerProfiles.findById(job.customerId);
      if (customer && customer.userId !== userId) recipientUserIds.add(customer.userId);
      if (job.professionalProfileId) {
        const professional = await this.professionals.findById(job.professionalProfileId);
        if (professional && professional.userId !== userId) recipientUserIds.add(professional.userId);
      }
      for (const recipientUserId of recipientUserIds) {
        await this.notifications.notify({
          userId: recipientUserId,
          type: "DISPUTE_STATUS_CHANGED",
          title: "New message on your dispute",
          message: `There's a new message on dispute ${dispute.caseNumber}.`,
          resourceType: "DISPUTE",
          resourceId: dispute.id,
          actionUrl: `/disputes/${dispute.id}`,
          metadata: { caseNumber: dispute.caseNumber },
        });
      }
    } catch (error) {
      console.error("Failed to create dispute-message notification", error);
    }

    return message;
  }
}
