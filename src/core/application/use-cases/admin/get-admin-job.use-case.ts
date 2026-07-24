import { NotFoundError } from "@/domain/errors/domain-error";
import type { AdminJobRecord, AdminRepository } from "@/domain/repositories/admin-repository";

export class GetAdminJobUseCase {
  constructor(private readonly admins: AdminRepository) {}

  async execute(jobId: string): Promise<AdminJobRecord> {
    const job = await this.admins.getJobById(jobId);
    if (!job) throw new NotFoundError("Job", jobId);
    return job;
  }
}
