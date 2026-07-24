import type {
  AdminProfessionalRecord,
  AdminRepository,
  ListAdminProfessionalsOptions,
} from "@/domain/repositories/admin-repository";

/** Admin Panel module (Module 16): paginated, searchable professional
 *  listing. Read-only oversight — see the module spec's 5.3 for the
 *  professional-verification boundary this deliberately stays out of. */
export class ListAdminProfessionalsUseCase {
  constructor(private readonly admins: AdminRepository) {}

  async execute(options: ListAdminProfessionalsOptions): Promise<AdminProfessionalRecord[]> {
    return this.admins.listProfessionals(options);
  }
}
