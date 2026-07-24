import { PrismaPortfolioRepository } from "@/infrastructure/database/prisma/repositories/prisma-portfolio-repository";
import { PrismaProfessionalRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-repository";
import { PrismaServiceCategoryRepository } from "@/infrastructure/database/prisma/repositories/prisma-service-category-repository";
import { CreatePortfolioItemUseCase } from "@/application/use-cases/portfolio/create-portfolio-item.use-case";
import { DeletePortfolioItemUseCase } from "@/application/use-cases/portfolio/delete-portfolio-item.use-case";
import { GetPortfolioItemForOwnerUseCase } from "@/application/use-cases/portfolio/get-portfolio-item-for-owner.use-case";
import { ListPortfolioItemsUseCase } from "@/application/use-cases/portfolio/list-portfolio-items.use-case";
import { UpdatePortfolioItemUseCase } from "@/application/use-cases/portfolio/update-portfolio-item.use-case";

const portfolioItems = new PrismaPortfolioRepository();
const professionals = new PrismaProfessionalRepository();
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
