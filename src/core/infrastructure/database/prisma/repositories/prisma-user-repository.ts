import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  AuthUserRecord,
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
  }): Promise<AuthUserRecord> {
    return prisma.user.create({
      data: {
        email: input.email,
        name: input.name,
        passwordHash: input.passwordHash,
        status: "PENDING_VERIFICATION",
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

  async assignDefaultRole(userId: string, roleKey: string): Promise<void> {
    const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId, roleId: role.id } },
      update: {},
      create: { userId, roleId: role.id },
    });
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
}
