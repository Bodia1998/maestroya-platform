import { NotFoundError } from "@/domain/errors/domain-error";
import type { AdminRepository, AdminServiceRequestRecord } from "@/domain/repositories/admin-repository";

export class GetAdminServiceRequestUseCase {
  constructor(private readonly admins: AdminRepository) {}

  async execute(serviceRequestId: string): Promise<AdminServiceRequestRecord> {
    const request = await this.admins.getServiceRequestById(serviceRequestId);
    if (!request) throw new NotFoundError("ServiceRequest", serviceRequestId);
    return request;
  }
}
