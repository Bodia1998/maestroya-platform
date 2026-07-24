import type { AdminJobRecord, AdminRepository, ListAdminJobsOptions } from "@/domain/repositories/admin-repository";

/** Admin Panel module (Module 16): paginated, status-filterable
 *  appointment/job oversight. Strictly read-only — see the module spec's
 *  5.6. Job is the authoritative execution-lifecycle record (see
 *  schema.prisma's Job model doc comment), so this is the entry point;
 *  `appointmentCount` surfaces how many scheduling visits belong to it
 *  without a separate Appointment-oriented listing. */
export class ListAdminJobsUseCase {
  constructor(private readonly admins: AdminRepository) {}

  async execute(options: ListAdminJobsOptions): Promise<AdminJobRecord[]> {
    return this.admins.listJobs(options);
  }
}
