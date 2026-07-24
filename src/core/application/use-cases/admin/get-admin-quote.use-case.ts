import { NotFoundError } from "@/domain/errors/domain-error";
import type { AdminQuoteRecord, AdminRepository } from "@/domain/repositories/admin-repository";

export class GetAdminQuoteUseCase {
  constructor(private readonly admins: AdminRepository) {}

  async execute(quoteId: string): Promise<AdminQuoteRecord> {
    const quote = await this.admins.getQuoteById(quoteId);
    if (!quote) throw new NotFoundError("Quote", quoteId);
    return quote;
  }
}
