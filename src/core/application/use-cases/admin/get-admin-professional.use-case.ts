import { NotFoundError } from "@/domain/errors/domain-error";
import type { AdminProfessionalRecord, AdminRepository } from "@/domain/repositories/admin-repository";

export class GetAdminProfessionalUseCase {
  constructor(private readonly admins: AdminRepository) {}

  async execute(professionalId: string): Promise<AdminProfessionalRecord> {
    const professional = await this.admins.getProfessionalById(professionalId);
    if (!professional) throw new NotFoundError("ProfessionalProfile", professionalId);
    return professional;
  }
}
