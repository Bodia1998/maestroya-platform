import type { ListPortfolioItemsOptions, PortfolioItemRecord, PortfolioRepository } from "@/domain/repositories/portfolio-repository";

/** Module 18 — Company Professional (extends Module 14): public listing of
 *  a company's portfolio — no authentication required, same "portfolio is
 *  public marketing data" rule as ListPortfolioItemsUseCase. */
export class ListCompanyPortfolioItemsUseCase {
  constructor(private readonly portfolioItems: PortfolioRepository) {}

  async execute(companyId: string, options: ListPortfolioItemsOptions): Promise<PortfolioItemRecord[]> {
    return this.portfolioItems.listByCompanyId(companyId, options);
  }
}
