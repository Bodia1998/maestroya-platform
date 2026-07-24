import { NotFoundError } from "@/domain/errors/domain-error";
import type { AdminRepository, AdminUserRecord } from "@/domain/repositories/admin-repository";

/** Admin Panel module (Module 16): a single user's safe admin-facing
 *  projection — never includes passwordHash or any auth token. */
export class GetAdminUserUseCase {
  constructor(private readonly admins: AdminRepository) {}

  async execute(userId: string): Promise<AdminUserRecord> {
    const user = await this.admins.getUserById(userId);
    if (!user) throw new NotFoundError("User", userId);
    return user;
  }
}
