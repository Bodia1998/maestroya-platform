import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * One-off backfill (Professional Onboarding activation fix): grants the
 * PROVIDER role to every user who already has a ProfessionalProfile but,
 * because ProfessionalProfile creation didn't previously assign it, is
 * still missing it. Run once after deploying the
 * PrismaProfessionalRepository.create change that makes profile creation
 * and role assignment atomic for every *new* profile going forward — this
 * script only catches already-existing profiles created before that change
 * shipped.
 *
 * Does not touch runtime application code or behavior — this is a
 * stand-alone maintenance script, run manually:
 *
 *   npx tsx prisma/backfill-provider-role.ts
 *
 * Idempotent and additive — same upsert shape as
 * PrismaUserRepository.assignDefaultRole, standalone here only because this
 * script (like prisma/seed.ts) runs outside the app via a bare PrismaClient,
 * never importing application code. Safe to re-run: never removes CUSTOMER
 * or any other existing role, and a user who already has PROVIDER is left
 * unchanged.
 */
async function main() {
  const providerRole = await prisma.role.findUniqueOrThrow({ where: { key: "PROVIDER" } });

  const professionalProfiles = await prisma.professionalProfile.findMany({
    where: { deletedAt: null },
    select: { userId: true },
  });

  for (const { userId } of professionalProfiles) {
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId, roleId: providerRole.id } },
      update: {},
      create: { userId, roleId: providerRole.id },
    });
  }

  console.log(
    `Backfill complete: checked ${professionalProfiles.length} professional profile(s), PROVIDER role ensured for all of them.`,
  );
}

main()
  .catch((error) => {
    console.error("Backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
