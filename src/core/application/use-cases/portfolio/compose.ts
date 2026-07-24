import { PrismaPortfolioRepository } from "@/infrastructure/database/prisma/repositories/prisma-portfolio-repository";
import { PrismaProfessionalRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-repository";
import { PrismaCompanyMembershipRepository } from "@/infrastructure/database/prisma/repositories/prisma-company-membership-repository";
import { PrismaServiceCategoryRepository } from "@/infrastructure/database/prisma/repositories/prisma-service-category-repository";
import { CreatePortfolioItemUseCase } from "@/application/use-cases/portfolio/create-portfolio-item.use-case";
import { DeletePortfolioItemUseCase } from "@/application/use-cases/portfolio/delete-portfolio-item.use-case";
import { GetPortfolioItemForOwnerUseCase } from "@/application/use-cases/portfolio/get-portfolio-item-for-owner.use-case";
import { ListPortfolioItemsUseCase } from "@/application/use-cases/portfolio/list-portfolio-items.use-case";
import { UpdatePortfolioItemUseCase } from "@/application/use-cases/portfolio/update-portfolio-item.use-case";
import { CreateCompanyPortfolioItemUseCase } from "@/application/use-cases/company/create-company-portfolio-item.use-case";
import { UpdateCompanyPortfolioItemUseCase } from "@/application/use-cases/company/update-company-portfolio-item.use-case";
import { DeleteCompanyPortfolioItemUseCase } from "@/application/use-cases/company/delete-company-portfolio-item.use-case";
import { ListCompanyPortfolioItemsUseCase } from "@/application/use-cases/company/list-company-portfolio-items.use-case";

const portfolioItems = new PrismaPortfolioRepository();
const professionals = new PrismaProfessionalRepository();
const companyMemberships = new PrismaCompanyMembershipRepository();
const categories = new PrismaServiceCategoryRepository();

export function makeCreatePortfolioItemUseCase() {
  return new CreatePortfolioItemUseCase(portfolioItems, professionals, categories);
}

export function makeUpdatePortfolioItemUseCase() {
  return new UpdatePortfolioItemUseCase(portfolioItems, professionals, categories);
}

export function makeDeletePortfolioItemUseCase() {
  return new DeletePortfolioItemUseCase(portfolioItems, professionals);
}

export function makeGetPortfolioItemForOwnerUseCase() {
  return new GetPortfolioItemForOwnerUseCase(portfolioItems, professionals);
}

export function makeListPortfolioItemsUseCase() {
  return new ListPortfolioItemsUseCase(portfolioItems);
}

// --- Company portfolios (Module 18 — Company Professional) ---

export function makeCreateCompanyPortfolioItemUseCase() {
  return new CreateCompanyPortfolioItemUseCase(portfolioItems, companyMemberships, categories);
}

export function makeUpdateCompanyPortfolioItemUseCase() {
  return new UpdateCompanyPortfolioItemUseCase(portfolioItems, companyMemberships, categories);
}

export function makeDeleteCompanyPortfolioItemUseCase() {
  return new DeleteCompanyPortfolioItemUseCase(portfolioItems, companyMemberships);
}

export function makeListCompanyPortfolioItemsUseCase() {
  return new ListCompanyPortfolioItemsUseCase(portfolioItems);
}
