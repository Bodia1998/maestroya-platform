import { PrismaCompanyRepository } from "@/infrastructure/database/prisma/repositories/prisma-company-repository";
import { PrismaCompanyMembershipRepository } from "@/infrastructure/database/prisma/repositories/prisma-company-membership-repository";
import { PrismaServiceCategoryRepository } from "@/infrastructure/database/prisma/repositories/prisma-service-category-repository";
import { CreateCompanyUseCase } from "@/application/use-cases/company/create-company.use-case";
import { GetCompanyForMemberUseCase } from "@/application/use-cases/company/get-company-for-member.use-case";
import { ListMyCompaniesUseCase } from "@/application/use-cases/company/list-my-companies.use-case";
import { UpdateCompanyUseCase } from "@/application/use-cases/company/update-company.use-case";
import { UpdateCompanyServicesUseCase } from "@/application/use-cases/company/update-company-services.use-case";

/**
 * Module 18 — Company Professional: composition root for the Company
 * aggregate's own use cases. Same "one shared repository instance, one
 * factory per use case" convention as every other module's compose.ts.
 */

const companies = new PrismaCompanyRepository();
const memberships = new PrismaCompanyMembershipRepository();
const categories = new PrismaServiceCategoryRepository();

export function makeCreateCompanyUseCase() {
  return new CreateCompanyUseCase(companies, memberships, categories);
}

export function makeGetCompanyForMemberUseCase() {
  return new GetCompanyForMemberUseCase(companies, memberships);
}

export function makeListMyCompaniesUseCase() {
  return new ListMyCompaniesUseCase(companies, memberships);
}

export function makeUpdateCompanyUseCase() {
  return new UpdateCompanyUseCase(companies, memberships);
}

export function makeUpdateCompanyServicesUseCase() {
  return new UpdateCompanyServicesUseCase(companies, memberships, categories);
}
