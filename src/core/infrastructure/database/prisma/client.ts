import { PrismaClient } from "@prisma/client";

/**
 * Prisma client singleton.
 *
 * In development, Next.js hot-reloads modules, which would otherwise create
 * a new PrismaClient (and a new DB connection pool) on every edit. Caching
 * the instance on `globalThis` avoids exhausting the Postgres connection
 * limit. This is the standard pattern recommended by Prisma for Next.js.
 *
 * This file lives in infrastructure — domain and application code must
 * never import PrismaClient directly. They depend on repository
 * *interfaces* defined in `src/core/domain/repositories`; concrete Prisma
 * repository implementations (in this same infrastructure layer) are the
 * only code allowed to import this client.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
