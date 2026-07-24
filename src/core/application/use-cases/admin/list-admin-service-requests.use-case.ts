import type {
  AdminRepository,
  AdminServiceRequestRecord,
  ListAdminServiceRequestsOptions,
} from "@/domain/repositories/admin-repository";

/** Admin Panel module (Module 16): paginated, status-filterable service
 *  request oversight. Strictly read-only — see the module spec's 5.4. */
export class ListAdminServiceRequestsUseCase {
  constructor(private readonly admins: AdminRepository) {}

  async execute(options: ListAdminServiceRequestsOptions): Promise<AdminServiceRequestRecord[]> {
    return this.admins.listServiceRequests(options);
  }
}
