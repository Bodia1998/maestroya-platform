import type {
  AdminPortfolioItemRecord,
  AdminRepository,
  ListAdminPortfolioItemsOptions,
} from "@/domain/repositories/admin-repository";

/** Admin Panel module (Module 16): paginated portfolio item oversight —
 *  every item is visible here regardless of moderation state, unlike the
 *  public-facing listing (PrismaPortfolioRepository.listByProfessionalId,
 *  which excludes moderated/deleted items). */
export class ListAdminPortfolioItemsUseCase {
  constructor(private readonly admins: AdminRepository) {}

  async execute(options: ListAdminPortfolioItemsOptions): Promise<AdminPortfolioItemRecord[]> {
    return this.admins.listPortfolioItems(options);
  }
}
