import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";
import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  AuthUserRecord,
  SignupIntentValue,
  UpdateProfileData,
  UserProfileRecord,
  UserRepository,
} from "@/domain/repositories/user-repository";

export class PrismaUserRepository implements UserRepository {
  async findByEmail(email: string): Promise<AuthUserRecord | null> {
    return prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        name: true,
        passwordHash: true,
        emailVerified: true,
        status: true,
      },
    });
  }

  async findById(id: string): Promise<AuthUserRecord | null> {
    return prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        passwordHash: true,
        emailVerified: true,
        status: true,
      },
    });
  }

  async createWithPassword(input: {
    email: string;
    name: string;
    passwordHash: string;
    signupIntent?: SignupIntentValue;
  }): Promise<AuthUserRecord> {
    return prisma.user.create({
      data: {
        email: input.email,
        name: input.name,
        passwordHash: input.passwordHash,
        status: "PENDING_VERIFICATION",
        signupIntent: input.signupIntent,
      },
      select: {
        id: true,
        email: true,
        name: true,
        passwordHash: true,
        emailVerified: true,
        status: true,
      },
    });
  }

  async updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
    await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  }

  async markEmailVerified(userId: string): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: { emailVerified: new Date(), status: "ACTIVE" },
    });
  }

  async updateLastLoginAt(userId: string): Promise<void> {
    await prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
  }

  async getRoleKeys(userId: string): Promise<string[]> {
    const userRoles = await prisma.userRole.findMany({
      where: { userId },
      select: { role: { select: { key: true } } },
    });
    return userRoles.map((ur) => ur.role.key);
  }

  // `client` defaults to the module-level `prisma` singleton — every
  // existing caller (RegisterUserUseCase, auth-config.ts's events.createUser)
  // is typed against the `UserRepository` interface, which still only
  // declares the 2-argument signature, so none of them are affected by this
  // optional third parameter. It exists solely so this exact method — not a
  // re-implementation of it — can also be run inside another repository's
  // `prisma.$transaction` (see PrismaProfessionalRepository.create), by
  // passing that transaction's `tx` client through instead of the singleton.
  async assignDefaultRole(
    userId: string,
    roleKey: string,
    client: Pick<typeof prisma, "role" | "userRole"> = prisma,
  ): Promise<void> {
    const role = await client.role.findUniqueOrThrow({ where: { key: roleKey } });
    await client.userRole.upsert({
      where: { userId_roleId: { userId, roleId: role.id } },
      update: {},
      create: { userId, roleId: role.id },
    });
  }

  // --- Professional Onboarding additions ---

  async getSignupIntent(userId: string): Promise<SignupIntentValue | null> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { signupIntent: true },
    });
    return (user?.signupIntent as SignupIntentValue | null) ?? null;
  }

  async clearSignupIntent(userId: string): Promise<void> {
    await prisma.user.update({ where: { id: userId }, data: { signupIntent: null } });
  }

  // --- Profile module additions ---

  async findProfileById(userId: string): Promise<UserProfileRecord | null> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        image: true,
        timezone: true,
        notificationPreferences: true,
        preferredLanguageId: true,
        status: true,
        passwordHash: true,
      },
    });
    if (!user) return null;

    const { passwordHash, ...rest } = user;
    return {
      ...rest,
      notificationPreferences:
        rest.notificationPreferences &&
        typeof rest.notificationPreferences === "object" &&
        !Array.isArray(rest.notificationPreferences)
          ? (rest.notificationPreferences as Record<string, unknown>)
          : null,
      hasPassword: passwordHash !== null,
    };
  }

  async updateProfile(userId: string, data: UpdateProfileData): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: {
        name: data.name,
        phone: data.phone,
        timezone: data.timezone,
        preferredLanguageId: data.preferredLanguageId,
        notificationPreferences: data.notificationPreferences
          ? JSON.parse(JSON.stringify(data.notificationPreferences))
          : undefined,
      },
    });
  }

  async updateAvatar(userId: string, imageUrl: string): Promise<void> {
    await prisma.user.update({ where: { id: userId }, data: { image: imageUrl } });
  }

  async softDeleteAccount(userId: string): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: { deletedAt: new Date(), status: "DEACTIVATED" },
    });
  }

  // --- Internationalization additions (Module 29) ---

  async getPreferredLocale(userId: string): Promise<string | null> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { preferredLocale: true },
    });
    // A deleted/unknown user and a user who never chose a language are
    // both "no stored preference" as far as locale resolution goes — the
    // caller falls through to Accept-Language either way, so this does
    // not need to distinguish them (and must not throw: rendering a page
    // in Spanish is always preferable to failing to render it).
    return user?.preferredLocale ?? null;
  }

  async updatePreferredLocale(userId: string, locale: string | null): Promise<void> {
    await prisma.user.update({ where: { id: userId }, data: { preferredLocale: locale } });
  }


  // --- Module 88: GDPR Erasure Execution ---

  async getErasureState(userId: string): Promise<{ personalDataErasedAt: Date | null } | null> {
    return prisma.user.findUnique({
      where: { id: userId },
      select: { personalDataErasedAt: true },
    });
  }

  /**
   * Anonymizes the User row in place — never a hard delete. See this
   * method's own doc comment on the `UserRepository` interface for why
   * anonymizing the one shared row is sufficient (every other table
   * referencing a user does so via a Restrict/SetNull foreign key that
   * keeps pointing at this same, now-anonymized, row).
   *
   * The `WHERE personalDataErasedAt IS NULL` guard makes this a single
   * atomic compare-and-set: `updateMany` reports how many rows it actually
   * touched, so two concurrent erasure attempts for the same user can
   * never both anonymize (and, critically, never both mint a fresh
   * pseudonymous email — only the winner's write happens at all).
   */
  async eraseAccount(userId: string): Promise<{ erased: boolean }> {
    const pseudonymousEmail = `erased-${randomUUID()}@erased.maestroya.invalid`;
    const now = new Date();

    const result = await prisma.user.updateMany({
      where: { id: userId, personalDataErasedAt: null },
      data: {
        name: "Deleted user",
        email: pseudonymousEmail,
        emailVerified: null,
        image: null,
        phone: null,
        phoneVerifiedAt: null,
        passwordHash: null,
        notificationPreferences: Prisma.DbNull,
        status: "DEACTIVATED",
        deletedAt: now,
        personalDataErasedAt: now,
      },
    });

    return { erased: result.count === 1 };
  }

  /**
   * Hard-deletes NextAuth `Session` rows and linked OAuth `Account` rows —
   * see this method's own doc comment on the `UserRepository` interface
   * for exactly what this does and does not invalidate.
   */
  async invalidateAllSessions(userId: string): Promise<void> {
    await prisma.$transaction([
      prisma.session.deleteMany({ where: { userId } }),
      prisma.account.deleteMany({ where: { userId } }),
    ]);
  }
}
