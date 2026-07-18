import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Seeds bootstrap/reference data: Languages, Roles, Service Categories
 * (+ default professions as subcategories), Admin/Support accounts,
 * geographic reference data (Spain → Valencia → Gandia), and Platform
 * Settings. No customer/professional/company data or transactional
 * records — those come from real usage, not a seed script.
 *
 * Every upsert keys on each table's natural unique field (code/slug/key/
 * email), so this script is safe to re-run against an already-seeded
 * database; it will not create duplicates or error on a second run.
 *
 * Scope note on Admin/Support accounts: the schema currently has no
 * password/credential field on User (Auth.js's OAuth-oriented fields
 * only) — that's an Authentication-phase concern, deliberately not
 * touched here. These seeded accounts exist and hold the ADMIN/SUPPORT
 * role, but have no way to log in via password until that phase adds one
 * (e.g. via a credentials provider + a passwordHash column, or by
 * inviting them through an OAuth provider).
 */

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@maestroya.es";
const SUPPORT_EMAIL = process.env.SEED_SUPPORT_EMAIL ?? "support@maestroya.es";

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
 * This list was reconciled with the Authentication module's explicit
 * role-based-authorization spec, which is now the authoritative source
 * for platform-wide roles:
 *  - CUSTOMER, ADMIN, SUPPORT kept as-is.
 *  - PROFESSIONAL renamed to PROVIDER (Authentication's exact wording).
 *  - SUPER_ADMIN and MODERATOR added — new in Authentication's spec.
 *  - COMPANY_ADMIN / COMPANY_MEMBER removed — company-level roles are a
 *    separate axis, already modeled by CompanyMember.role
 *    (CompanyMemberRole: OWNER/ADMIN/MEMBER) rather than this
 *    platform-wide Role table. Keeping both would have meant two
 *    different, overlapping "admin"/"member" concepts.
 */
const ROLES = [
  { key: "CUSTOMER", name: "Customer", description: "Requests services on the platform." },
  { key: "PROVIDER", name: "Provider", description: "Solo freelance provider offering services." },
  { key: "ADMIN", name: "Admin", description: "Platform administrator with full access." },
  { key: "SUPER_ADMIN", name: "Super Admin", description: "Highest-privilege platform administrator." },
  { key: "SUPPORT", name: "Support", description: "Platform support/trust & safety staff." },
  { key: "MODERATOR", name: "Moderator", description: "Reviews and moderates content, disputes, and reports." },
] as const;

/**
 * These six top-level categories match the ones already established for
 * MaestroYa's brand/marketing site in the earlier landing-page design
 * spec (design_guidelines.json from an earlier phase of this project) —
 * kept identical here for continuity. Each carries a `professions` list:
 * ServiceCategory is self-referencing (parentId), so "default
 * professions" are seeded as child categories rather than a separate
 * model — e.g. "Fontanero" (plumber) nests under "Fontanería" (plumbing).
 */
const SERVICE_CATEGORIES = [
  {
    slug: "fontaneria",
    name: "Fontanería",
    description: "Reparación de fugas, grifos, tuberías e instalaciones de agua.",
    professions: [{ slug: "fontanero", name: "Fontanero" }],
  },
  {
    slug: "electricidad",
    name: "Electricidad",
    description: "Instalaciones eléctricas, averías, cuadros y enchufes.",
    professions: [{ slug: "electricista", name: "Electricista" }],
  },
  {
    slug: "aire-acondicionado",
    name: "Aire acondicionado",
    description: "Instalación, mantenimiento y reparación de climatización.",
    professions: [{ slug: "tecnico-climatizacion", name: "Técnico de climatización" }],
  },
  {
    slug: "pintura",
    name: "Pintura",
    description: "Pintura interior y exterior, alisado de paredes y acabados.",
    professions: [{ slug: "pintor", name: "Pintor" }],
  },
  {
    slug: "reformas",
    name: "Reformas",
    description: "Reformas integrales y parciales de hogar.",
    professions: [{ slug: "reformista", name: "Reformista" }],
  },
  {
    slug: "montaje-de-muebles",
    name: "Montaje de muebles",
    description: "Montaje y ensamblaje de muebles y mobiliario.",
    professions: [{ slug: "montador-de-muebles", name: "Montador de muebles" }],
  },
] as const;

const PLATFORM_SETTINGS = [
  {
    key: "default_commission_rate_bps",
    value: 1000, // 10.00%, in basis points — see Commission.rateBps in schema.prisma
    description: "Default platform commission rate applied to new commissions, in basis points.",
  },
  {
    key: "platform_currency",
    value: "EUR",
    description: "Default currency for new payments/quotes/payouts.",
  },
  {
    key: "support_email",
    value: SUPPORT_EMAIL,
    description: "Public-facing support contact email.",
  },
  {
    key: "maintenance_mode",
    value: false,
    description: "When true, the app should show a maintenance page instead of normal traffic.",
  },
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

async function seedServiceCategoriesAndProfessions() {
  let professionCount = 0;

  for (const [index, category] of SERVICE_CATEGORIES.entries()) {
    const parent = await prisma.serviceCategory.upsert({
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

    for (const [profIndex, profession] of category.professions.entries()) {
      await prisma.serviceCategory.upsert({
        where: { slug: profession.slug },
        update: {
          name: profession.name,
          parentId: parent.id,
          sortOrder: profIndex,
        },
        create: {
          slug: profession.slug,
          name: profession.name,
          parentId: parent.id,
          sortOrder: profIndex,
        },
      });
      professionCount += 1;
    }
  }

  console.log(
    `Seeded ${SERVICE_CATEGORIES.length} service categories and ${professionCount} default professions.`,
  );
}

async function seedGeography() {
  const spain = await prisma.country.upsert({
    where: { code: "ES" },
    update: { name: "Spain" },
    create: { code: "ES", name: "Spain" },
  });

  const valencia = await prisma.province.upsert({
    where: { countryId_name: { countryId: spain.id, name: "Valencia" } },
    update: {},
    create: { countryId: spain.id, name: "Valencia" },
  });

  await prisma.city.upsert({
    where: { provinceId_name: { provinceId: valencia.id, name: "Gandia" } },
    update: {},
    create: { provinceId: valencia.id, name: "Gandia" },
  });

  console.log("Seeded geography: Spain → Valencia → Gandia.");
}

async function seedPlatformSettings() {
  for (const setting of PLATFORM_SETTINGS) {
    await prisma.platformSetting.upsert({
      where: { key: setting.key },
      update: { value: setting.value, description: setting.description },
      create: setting,
    });
  }
  console.log(`Seeded ${PLATFORM_SETTINGS.length} platform settings.`);
}

/**
 * Creates the Admin and Support bootstrap accounts and assigns each their
 * role. Must run after seedRoles() — it looks up role ids by key rather
 * than assuming any particular order/id.
 */
async function seedAdminAndSupportAccounts() {
  const [adminRole, supportRole] = await Promise.all([
    prisma.role.findUniqueOrThrow({ where: { key: "ADMIN" } }),
    prisma.role.findUniqueOrThrow({ where: { key: "SUPPORT" } }),
  ]);

  const admin = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: {},
    create: {
      email: ADMIN_EMAIL,
      name: "MaestroYa Admin",
      status: "ACTIVE",
      emailVerified: new Date(),
    },
  });

  const support = await prisma.user.upsert({
    where: { email: SUPPORT_EMAIL },
    update: {},
    create: {
      email: SUPPORT_EMAIL,
      name: "MaestroYa Support",
      status: "ACTIVE",
      emailVerified: new Date(),
    },
  });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: admin.id, roleId: adminRole.id } },
    update: {},
    create: { userId: admin.id, roleId: adminRole.id },
  });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: support.id, roleId: supportRole.id } },
    update: {},
    create: { userId: support.id, roleId: supportRole.id },
  });

  console.log(`Seeded admin account (${ADMIN_EMAIL}) and support account (${SUPPORT_EMAIL}).`);
}

async function main() {
  // Order matters: roles before accounts (accounts look up role ids).
  await seedLanguages();
  await seedRoles();
  await seedServiceCategoriesAndProfessions();
  await seedGeography();
  await seedPlatformSettings();
  await seedAdminAndSupportAccounts();
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
