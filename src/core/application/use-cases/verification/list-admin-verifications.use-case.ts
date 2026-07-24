import type {
  AdminVerificationListItem,
  ListAdminVerificationsOptions,
  ProfessionalVerificationRepository,
} from "@/domain/repositories/professional-verification-repository";

/**
 * Professional Verification module (Module 17): the admin review queue —
 * paginated, optionally filtered by status. Authorization (ADMIN/
 * SUPER_ADMIN) is enforced at the Server Action boundary via requireRole();
 * this use case is a thin read that never exposes document URLs (list items
 * carry no file references at all — see AdminVerificationListItem).
 */
export class ListAdminVerificationsUseCase {
  constructor(private readonly verifications: ProfessionalVerificationRepository) {}

  async execute(options: ListAdminVerificationsOptions): Promise<AdminVerificationListItem[]> {
    return this.verifications.listForAdmin(options);
  }
}
