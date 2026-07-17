import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Seeds reference data only — Languages, Service Categories, Roles — per
 * Phase 1's scope. No users, requests, or other transactional data.
 *
 * Every upsert keys on each table's natural unique field (code/slug/key),
 * so this script is safe to re-run against an already-seeded database;
 * it will not create duplicates or error on a second run.
 */

const LANGUAGES = [
  { code: "es", name: "Spanish", nativeName: "Español" },
  { code: "ca", name: "Catalan", nativeName: "Català" },
  { code: "eu", name: "Basque", nativeName: "Euskara" },
  { code: "gl", name: "Galician", nativeName: "Galego" },
  { code: "en", name: "English", nativeName: "English" },
  { code: "fr", name: "French", nativeName: "Français" },
  { code: "de", name: "German", nativeName: "Deutsch" },
  { code: "ar", name: "Arabic", nativeName: "العربية" },
  { code: "ro", name: "Romanian", nativeName: "Română" },
  { code: "zh", name: "Chinese", nativeName: "中文" },
] as const;

/**
 * These six top-level categories match the ones already established for
 * MaestroYa's brand/marketing site in the earlier landing-page design spec
 * (design_guidelines.json from the previous phase of this project) —
 * kept identical here for continuity between the marketing site and the
 * real catalog data model.
 */
const SERVICE_CATEGORIES = [
  { slug: "fontaneria", name: "Fontanería", description: "Reparación de fugas, grifos, tuberías e instalaciones de agua." },
  { slug: "electricidad", name: "Electricidad", description: "Instalaciones eléctricas, averías, cuadros y enchufes." },
  { slug: "aire-acondicionado", name: "Aire acondicionado", description: "Instalación, mantenimiento y reparación de climatización." },
  { slug: "pintura", name: "Pintura", description: "Pintura interior y exterior, alisado de paredes y acabados." },
  { slug: "reformas", name: "Reformas", description: "Reformas integrales y parciales de hogar." },
  { slug: "montaje-de-muebles", name: "Montaje de muebles", description: "Montaje y ensamblaje de muebles y mobiliario." },
] as const;

const ROLES = [
  { key: "CUSTOMER", name: "Customer", description: "Requests services on the platform." },
  { key: "PROFESSIONAL", name: "Professional", description: "Solo freelance provider offering services." },
  { key: "COMPANY_ADMIN", name: "Company Admin", description: "Owner/admin of a company account, manages members and quotes." },
  { key: "COMPANY_MEMBER", name: "Company Member", description: "Employee of a company account, can act on its behalf." },
  { key: "ADMIN", name: "Admin", description: "Platform administrator with full access." },
  { key: "SUPPORT", name: "Support", description: "Platform support/trust & safety staff." },
] as const;

async function seedLanguages() {
  for (const language of LANGUAGES) {
    await prisma.language.upsert({
      where: { code: language.code },
      update: { name: language.name, nativeName: language.nativeName },
      create: language,
    });
  }
  console.log(`Seeded ${LANGUAGES.length} languages.`);
}

async function seedServiceCategories() {
  for (const [index, category] of SERVICE_CATEGORIES.entries()) {
    await prisma.serviceCategory.upsert({
      where: { slug: category.slug },
      update: {
        name: category.name,
        description: category.description,
        sortOrder: index,
      },
      create: {
        slug: category.slug,
        name: category.name,
        description: category.description,
        sortOrder: index,
      },
    });
  }
  console.log(`Seeded ${SERVICE_CATEGORIES.length} service categories.`);
}

async function seedRoles() {
  for (const role of ROLES) {
    await prisma.role.upsert({
      where: { key: role.key },
      update: { name: role.name, description: role.description },
      create: role,
    });
  }
  console.log(`Seeded ${ROLES.length} roles.`);
}

async function main() {
  await seedLanguages();
  await seedServiceCategories();
  await seedRoles();
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
