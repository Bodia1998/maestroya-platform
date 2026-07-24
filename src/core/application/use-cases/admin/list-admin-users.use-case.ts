import type { AdminRepository, AdminUserRecord, ListAdminUsersOptions } from "@/domain/repositories/admin-repository";

/** Admin Panel module (Module 16): paginated, searchable user listing. */
export class ListAdminUsersUseCase {
  constructor(private readonly admins: AdminRepository) {}

  async execute(options: ListAdminUsersOptions): Promise<AdminUserRecord[]> {
    return this.admins.listUsers(options);
  }
}
