import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { DisputeRepository } from "@/domain/repositories/dispute-repository";
import type {
  DisputeEvidenceRecord,
  DisputeEvidenceRepository,
} from "@/domain/repositories/dispute-evidence-repository";
import type { JobRepository } from "@/domain/repositories/job-repository";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { CompanyMembershipRepository } from "@/domain/repositories/company-membership-repository";
import { resolveDisputeActor } from "@/application/use-cases/dispute/resolve-dispute-actor";
import { isTerminalStatus } from "@/domain/services/dispute-state";
import { isValidMediaUrl } from "@/domain/services/portfolio-rules";

export interface AddDisputeEvidenceInput {
  fileUrl: string;
  fileName: string | null;
  fileType: string | null;
  fileSizeBytes: number | null;
  description: string | null;
}

/**
 * Module 21 — Disputes & Support: attaches evidence (photos/documents) to a
 * Dispute. Reuses the existing storage abstraction end to end — this use
 * case never uploads a file itself, it only persists the URL + metadata a
 * file was already uploaded to (see DisputeEvidenceRepository's own doc
 * comment on the "URL + metadata" pattern this mirrors from
 * MessageAttachment/PortfolioItem/VerificationDocument). The caller
 * (Server Action) is responsible for having already run the upload through
 * `src/core/infrastructure/storage` and passing back the resulting URL.
 *
 * Same authorization/terminal-state rules as AddDisputeMessageUseCase — a
 * case participant may attach evidence at any point before the case is
 * closed; an admin may also attach evidence via `isAdminCaller: true`.
 */
export class AddDisputeEvidenceUseCase {
  constructor(
    private readonly disputes: DisputeRepository,
    private readonly disputeEvidence: DisputeEvidenceRepository,
    private readonly jobs: JobRepository,
    private readonly customerProfiles: CustomerProfileRepository,
    private readonly professionals: ProfessionalRepository,
    private readonly companyMembers: CompanyMembershipRepository,
    private readonly auditLog: AdminAuditLogRepository,
  ) {}

  async execute(
    userId: string,
    disputeId: string,
    input: AddDisputeEvidenceInput,
    options: { isAdminCaller?: boolean } = {},
  ): Promise<DisputeEvidenceRecord> {
    const dispute = await this.disputes.findById(disputeId);
    if (!dispute) {
      throw new NotFoundError("Dispute", disputeId);
    }

    if (isTerminalStatus(dispute.status)) {
      throw new ValidationError("This dispute is closed and no longer accepts new evidence.");
    }

    // Module 33 — Security Hardening: re-checked here too (not just in the
    // Server Action's Zod schema) — this use case shouldn't blindly trust
    // its caller either, same defense-in-depth convention as the
    // Cloudinary upload services' own re-checked MIME allowlist. Rejects
    // `javascript:`/`data:`/other dangerous schemes that would otherwise
    // be stored and later rendered as a clickable evidence link.
    if (!isValidMediaUrl(input.fileUrl)) {
      throw new ValidationError("File URL must be an http(s) link.");
    }

    if (!options.isAdminCaller) {
      const job = await this.jobs.findById(dispute.jobId);
      if (!job) {
        throw new NotFoundError("Dispute", disputeId);
      }
      await resolveDisputeActor(userId, dispute, job, {
        customerProfiles: this.customerProfiles,
        professionals: this.professionals,
        companyMembers: this.companyMembers,
      });
    }

    const evidence = await this.disputeEvidence.create({
      disputeId,
      submittedByUserId: userId,
      fileUrl: input.fileUrl,
      fileName: input.fileName,
      fileType: input.fileType,
      fileSizeBytes: input.fileSizeBytes,
      description: input.description,
    });

    try {
      await this.auditLog.record({
        adminUserId: userId,
        action: "DISPUTE_EVIDENCE_ADDED",
        targetType: "Dispute",
        targetId: disputeId,
        // Reference only (evidence id), never the file content/URL itself
        // — see the module spec's "do not log sensitive data unnecessarily"
        // requirement.
        metadata: { evidenceId: evidence.id },
      });
    } catch (error) {
      console.error("Failed to record dispute-evidence-added audit log", error);
    }

    return evidence;
  }
}
